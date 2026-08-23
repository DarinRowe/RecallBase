# Bun 1.4 upgrade research

Reviewed on 2026-08-23 against Bun `1.4.0`, release commit
[`34cbb9a`](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0). The
pre-upgrade RecallBase baseline was Bun `1.3.14`, `@types/bun@1.3.14`,
TypeScript `5.9.3`, a Bun workspace monorepo, `bun:sqlite`, `bun:test`, and
cross-compiled standalone executables for macOS, Linux, and Windows. Only
Bun's official website, documentation, and repositories were used.

## Summary

Upgrade development, CI, and packaging to exactly Bun `1.4.0`, and keep the
runtime and type definitions on the same minor version. The repository records
that version once as `"packageManager": "bun@1.4.0"`; the official
`oven-sh/setup-bun` action reads that field when a workflow does not supply a
version, so CI does not need a second version literal.
[`setup-bun` version resolution](https://github.com/oven-sh/setup-bun#usage)

The upgrade is low-risk for RecallBase's application code. The project has no
Node native-addon dependency, FFI, HTTP server, JSX, CSS/XML imports, or Bun
TOML/YAML parsing. Its existing workspace lockfile already has
`configVersion: 1`, so there is no linker-layout transition. Bun 1.4 reports
Node.js 26.3 and `NODE_MODULE_VERSION` 147, but the bundled `bun:sqlite` module
does not require an external ABI build.
[`Upgrading to Bun 1.4`](https://bun.com/blog/bun-v1.4#upgrading-to-14)

The release process does need one explicit mitigation. Bun 1.4.0 generates an
invalid ad-hoc signature for macOS arm64 standalone executables; macOS 27 kills
those binaries at launch. Bun merged the signing fix into `main` on 2026-08-22,
but the latest stable release reviewed here remains 1.4.0. RecallBase therefore
re-signs every macOS artifact with `codesign --force --sign -` after
`Bun.build()` and requires `codesign --verify --strict` in packaging smoke.
Keep that workaround until a stable Bun release containing the upstream fix is
adopted and verified.
[`1.4.0 failure report`](https://github.com/oven-sh/bun/issues/39764),
[`upstream signing fix`](https://github.com/oven-sh/bun/pull/39837),
[`Bun code-signing guidance`](https://bun.com/docs/bundler/executables#code-signing-on-macos)

Do not add a product dependency on a new 1.4 API merely to use it. The best
immediate gains are the upgraded runtime itself, bounded parallel tests,
reproducible installs, and stronger release verification. Evaluate the new
test timing and package-maintenance commands as follow-ups. Keep RecallBase's
line-aware JSONL reader and `bun:sqlite` implementation.

## Version information

| Item | Before | Upgrade decision | Notes |
| --- | --- | --- | --- |
| Bun runtime/toolchain | `1.3.14` | `1.4.0` exact | Latest stable on 2026-08-23 |
| Bun type definitions | `@types/bun@1.3.14` | `@types/bun@1.4.0` | Keep runtime and API types aligned |
| TypeScript | `5.9.3` | Keep `5.9.3` | Bun's new `bun init` template version is irrelevant to an existing project |
| Workspace linker | `configVersion: 1` | Keep existing layout | Do not regenerate `node_modules` layout as a separate migration |
| Lockfile format | `lockfileVersion: 1` | Existing v1 is supported | A deliberate v2 rewrite is one-way for older Bun versions |
| Compiled targets | macOS arm64/x64, Linux arm64/x64, Windows x64 | Keep targets | Windows arm64 is a future distribution option, not part of this runtime upgrade |

Bun 1.4's new lockfiles use `lockfileVersion: 2`. V2 requires integrity for npm
tarballs outside the configured registry and rejects unsafe git dependency
paths. Bun 1.4 continues to read v0/v1 lockfiles, while older Bun versions
cannot read v2. Preserve the reviewed lockfile unless there is a deliberate
security-format migration; if migrating, commit the result together with the
minimum-Bun change and verify every workflow uses 1.4.
[`lockfileVersion: 2`](https://bun.com/blog/bun-v1.4#bun-lock-is-now-lockfileversion-2),
[`official lockfile documentation`](https://bun.com/docs/pm/lockfile)

The release also collapses x64 distribution to the baseline binary. Existing
non-baseline download names and target names still resolve, so RecallBase's
`bun-darwin-x64` and `bun-linux-x64` targets do not need renaming. Exact x64
runtime smoke remains necessary.
[`x64 baseline-only change`](https://bun.com/blog/bun-v1.4#x64-builds-are-now-baseline-only)

## Key concepts

### A toolchain upgrade also changes the shipped application runtime

RecallBase does not only use Bun to install and test dependencies. Every
release binary embeds the Bun runtime selected by `Bun.build({ compile: ... })`.
Changing the toolchain therefore changes CLI startup, SQLite, filesystem,
subprocess, module-resolution, and executable-signing behavior for users. A
green source test suite is necessary but not sufficient; the exact archived
binary and npm shim must run on their destination architecture.
[`standalone executable model`](https://bun.com/docs/bundler/executables)

Bun reports substantially faster startup on Linux and Windows and a smaller
Linux/Windows binary in its own 1.4 benchmarks. These are promising for a
short-lived CLI, but they are not RecallBase measurements. Retain the project's
packaging-size and performance baselines rather than copying Bun's benchmark
claims into product documentation.
[`Bun 1.4 startup and binary-size measurements`](https://bun.com/blog/bun-v1.4#production)

### Parallel test files are isolated worker processes

`bun test --parallel=N` schedules files across worker processes and implies
`--isolate`. Coverage and JUnit output are merged. This is different from
`--concurrent`, which changes test execution within files. RecallBase should use
a fixed, modest worker count so CI behavior is stable and packaging or native-
host tests do not saturate machines. Tests that share a fixed path, port,
registry key, or output directory can still race even though their JavaScript
globals are isolated.
[`bun test --parallel`](https://bun.com/blog/bun-v1.4#bun-test-parallel)

Parallel test support first appeared on the 1.3 release line, so it is an
upgrade-adjacent adoption rather than a strictly 1.4-only API. Bun 1.4 adds
`--timings=<path>` and `--update-timings`, which can balance workers or CI
shards by measured file duration. A committed timing file is worthwhile only
after CI shows meaningful skew; it otherwise creates maintenance churn.
[`bun test --timings`](https://bun.com/blog/bun-v1.4#bun-test-timings)

### Compiled executables still read some working-directory configuration

Standalone executables no longer auto-load `tsconfig.json` or `package.json`
from the directory in which a user launches them, but `.env` and `bunfig.toml`
still auto-load by default. RecallBase reads environment variables such as its
database override, and users may launch `rb` inside untrusted or unrelated
projects. RecallBase now sets `compile.autoloadDotenv: false` and
`compile.autoloadBunfig: false` so a project-local file cannot silently change
the distributed CLI. This does not discard environment variables inherited
from the real parent process. Packaging smoke launches the compiled binary
from a directory containing a conflicting `.env` and invalid `bunfig.toml` to
keep this boundary covered.
[`automatic config loading`](https://bun.com/docs/bundler/executables#automatic-config-loading)

### Error recovery matters more than JSONL parser throughput

`Bun.JSONL.parse()` and `parseChunk()` are fast native APIs, but their official
error semantics do not match RecallBase's importer contract. `parse()` returns
successfully parsed values without throwing when invalid input occurs after at
least one record. `parseChunk()` stops at the first invalid record and exposes
an offset and one error, not source line metadata or automatic recovery after
that line. RecallBase must continue importing later valid records, emit a
line-specific diagnostic, preserve raw evidence, and distinguish a trailing
incomplete line from malformed durable history.
[`Bun.JSONL error handling`](https://bun.com/docs/runtime/jsonl#error-handling),
[`Bun.JSONL.parseChunk()`](https://bun.com/docs/runtime/jsonl#bunjsonlparsechunk)

Keep `packages/importers/src/common/json.ts` on its current line-aware
`readline` plus `JSON.parse` design. Reconsider only after a benchmark shows
JSON parsing to be a material import bottleneck and a wrapper can preserve all
diagnostics and recovery behavior.

## Implementation guide

### 1. Pin the runtime once and align its types

Use the root manifest as the source of truth:

```json
{
  "packageManager": "bun@1.4.0",
  "devDependencies": {
    "@types/bun": "^1.4.0"
  }
}
```

`oven-sh/setup-bun@v2` checks `package.json#packageManager` before falling back
to `engines.bun` or `latest`. Removing duplicated workflow literals keeps
development, CI, release smoke, and release builds synchronized without
floating to an unreviewed release.
[`setup-bun usage`](https://github.com/oven-sh/setup-bun#usage)

Use `bun install --frozen-lockfile` (or its `bun ci` alias) in automation. It
must fail instead of updating dependency resolution during a build.
[`bun install in CI`](https://bun.com/docs/pm/cli/install#cicd)

### 2. Adopt bounded file-level test parallelism

Keep the full suite as the required CI signal:

```json
{
  "scripts": {
    "test": "bun test --parallel=4"
  }
}
```

Do not replace full CI with `bun test --changed`. That command walks the static
import graph from `git diff`, while RecallBase tests also depend on fixtures,
shell scripts, packaging metadata, workflows, and generated artifacts that may
not appear as TypeScript imports. `--changed` is useful as an optional local
feedback command only.
[`bun test --changed`](https://bun.com/blog/bun-v1.4#bun-test-changed)

### 3. Make compiled CLI configuration explicit

The standalone build now makes its runtime boundary visible:

```ts
const result = await Bun.build({
  entrypoints: [entrypoint],
  target: "bun",
  compile: {
    outfile,
    autoloadDotenv: false,
    autoloadBunfig: false,
    ...(target ? { target } : {})
  }
});
```

The accompanying smoke case launches the binary from a temporary directory
containing conflicting `.env` and `bunfig.toml` files. It verifies the files do
not affect command startup; any future test of an explicitly inherited
`RECALLBASE_*` variable should continue to verify that real parent-process
environment remains supported.

### 4. Re-sign and verify macOS artifacts

For every `bun-darwin-*` output built with Bun 1.4.0:

```bash
codesign --force --sign - ./rb
codesign --verify --strict ./rb
```

RecallBase applies this after the compile step, and packaging smoke verifies the
result. Packaging a macOS target on a non-macOS host must fail because the
artifact cannot be validated there. The upstream fix independently recomputes
Mach-O page hashes and truncates stale signature bytes; after a Bun patch
containing that fix is adopted, keep strict verification even if the explicit
re-sign step becomes redundant.
[`upstream fix and verification`](https://github.com/oven-sh/bun/pull/39837)

### 5. Preserve the product storage API

Bun 1.4 implements `node:sqlite`, but RecallBase already depends directly on
`bun:sqlite` and ships a Bun runtime. Switching APIs would be a database-layer
migration with no current compatibility benefit, and it would risk FTS,
transaction, serialization, and error-shape differences. Keep `bun:sqlite` and
the existing SQLite/FTS packaging smoke.
[`node:sqlite` implementation](https://bun.com/blog/bun-v1.4#nodesqlite)

## Best practices and opportunities

### Adopt now

- Run dependency installation with `--frozen-lockfile` in every CI, release,
  and smoke workflow.
- Run the complete suite with a fixed `--parallel=4`, then retain targeted
  platform tests where exact OS behavior matters.
- Re-sign every macOS standalone executable and verify it with
  `codesign --verify --strict` before archiving.
- Disable `.env` and `bunfig.toml` auto-loading in the distributed executable.
- Keep TypeScript at 5.9.3 for this upgrade. A TypeScript major change should
  have its own compatibility review.

### Evaluate after the upgrade

- `bun test --timings` can record slow files and balance the fixed worker pool.
  Adopt it only if CI wall time or skew justifies a versioned timings file.
  [`timings`](https://bun.com/blog/bun-v1.4#bun-test-timings)
- `bun audit fix --dry-run` gives a non-mutating remediation plan, and
  `bun dedupe --check` exits nonzero when one locked version could satisfy
  duplicate ranges. They are suitable maintenance or scheduled CI checks; do
  not run the mutating forms automatically on release branches.
  [`audit fix`](https://bun.com/docs/pm/cli/audit#bun-audit-fix),
  [`dedupe check`](https://bun.com/docs/pm/cli/dedupe#check-and-dry-run)
- `--cpu-prof-md` and `--heap-prof-md` produce terminal-reviewable profiles.
  Use them when investigating `tests/perf` or real local search regressions,
  keeping profile files out of commits because they may contain code paths or
  runtime data.
  [`Markdown profilers`](https://bun.com/blog/bun-v1.4#observability)
- Bun 1.4 and the standalone compiler support Windows arm64. Add
  `bun-windows-arm64` only with an actual arm64 verification runner, npm
  platform package, release manifest entry, install-path tests, and native-host
  smoke. Cross-compilation alone is not support.
  [`supported standalone targets`](https://bun.com/docs/bundler/executables#supported-targets)
- `Bun.isStandaloneExecutable` is now a zero-allocation way to distinguish a
  compiled binary. Use it only when product behavior genuinely must differ;
  there is no current need for a source/compiled branch.
  [`Bun.isStandaloneExecutable`](https://bun.com/blog/bun-v1.4#bun-isstandaloneexecutable)

### Do not adopt now

- Do not replace the importer JSONL reader with `Bun.JSONL`; its recovery and
  diagnostic shape is too weak for RecallBase's durable-history boundary.
- Do not migrate from `bun:sqlite` to `node:sqlite` solely for API novelty.
- Do not replace release archive creation with `Bun.Archive` in this upgrade.
  The existing writer explicitly controls tar entry name, mode, ownership,
  timestamp, and checksum behavior; the documented Archive examples do not
  establish an equivalent reproducibility contract.
  [`Bun.Archive`](https://bun.com/docs/runtime/archive)
- Do not use `bun prune` in the release path. RecallBase ships a standalone
  executable rather than `node_modules`, so pruning provides no artifact
  benefit.
  [`bun prune`](https://bun.com/docs/pm/cli/prune)
- Do not add `Bun.cron`, `Bun.WebView`, `Bun.Terminal`, image processing,
  Markdown rendering, XML parsing, or React compilation as part of a runtime
  upgrade. Each represents new product behavior, privileges, persistence, or
  an untrusted-content boundary and needs a separate product decision.

## Common issues and migration risks

| Risk | RecallBase exposure | Required handling |
| --- | --- | --- |
| macOS arm64 invalid ad-hoc signature in stable 1.4.0 | High: all public macOS arm64 binaries are compiled | Re-sign, strict-verify, run exact packaged binary; remove workaround only after verified stable upstream fix |
| Node.js target becomes 26.3 / ABI 147 | Low: no external native addon | Keep cross-platform source, compiled, SQLite, and subprocess smoke |
| Lockfile v2 is unreadable by older Bun | Medium if deliberately migrated | Change runtime floor and lockfile together; use frozen installs everywhere |
| New monorepos default to isolated linker | Low: existing lock records `configVersion: 1` | Preserve current lock/config; avoid unrelated linker churn |
| x64 artifacts are baseline-only | Low: existing target names remain valid | Keep Intel Linux/macOS and Windows x64 execution smoke |
| File-level parallel tests expose shared resources | Medium: packaging/native-host tests touch files and OS state | Bound workers, allocate unique temp roots, retain targeted serial platform jobs |
| Compiled binary loads cwd `.env`/`bunfig.toml` | High for deterministic local-first CLI behavior | Disable both compile autoload options and test hostile cwd files |
| `Bun.JSONL` stops at malformed input | High if substituted into importers | Keep line-aware parser and recovery contract |

Other 1.4 behavior changes are currently outside the repository's used
surface. There is no `res.writeHeader()`, raw paused-stream `read()`, FFI
`CString`, Bun socket keepalive, Bun TOML/YAML parser, XML/CSS runtime import,
or JSX emit path to migrate.
[`complete behavior-change section`](https://bun.com/blog/bun-v1.4#upgrading-to-14)

## Verification checklist

Run these checks with a clean dependency tree and Bun 1.4.0:

```bash
bun --version
bun --revision
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run test:packaging
bun run perf
bun run package:release:test
bun run scripts/package-npm.ts --targets=host
```

Then verify the release boundary:

1. Confirm `bun --version` is `1.4.0` and record the revision in failed CI
   diagnostics.
2. Run the full test suite serially once and with `--parallel=4` repeatedly.
   The same tests must pass; parallelism is not allowed to hide a serial-only
   failure.
3. Review `bun.lock` and accept only expected type-definition or explicit
   format changes. A frozen clean install must make no write.
4. For every release target, run the exact archived binary on that OS and
   architecture, exercise `--version`, `--help`, JSON output, SQLite/FTS, native
   host installation, and native host health.
5. On macOS arm64 and x64, run `codesign --verify --strict` on the binary after
   extraction, not only on the pre-archive build output.
6. Launch a compiled `rb` from a directory with conflicting `.env`,
   `bunfig.toml`, `package.json`, and `tsconfig.json`; none may alter its runtime
   except environment explicitly inherited from the parent process.
7. Run importer fixtures containing a malformed middle JSONL line and a
   trailing incomplete line. Later valid records must still import and evidence
   line numbers must remain stable.
8. Compare `tests/perf` results and release artifact sizes to the 1.3.14
   baseline. Investigate regressions instead of assuming Bun's general
   benchmarks apply to RecallBase.

## References

- [Bun 1.4 official release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.0)
- [Bun 1.4 official release notes](https://bun.com/blog/bun-v1.4)
- [Official 1.4 breaking-change tracker](https://github.com/oven-sh/bun/issues/28792)
- [Bun installation and exact-version guidance](https://bun.com/docs/installation)
- [Bun lockfile documentation](https://bun.com/docs/pm/lockfile)
- [Bun standalone executable documentation](https://bun.com/docs/bundler/executables)
- [Bun JSONL documentation](https://bun.com/docs/runtime/jsonl)
- [Bun test runner documentation](https://bun.com/docs/test)
- [Bun package audit documentation](https://bun.com/docs/pm/cli/audit)
- [Bun dedupe documentation](https://bun.com/docs/pm/cli/dedupe)
- [Bun prune documentation](https://bun.com/docs/pm/cli/prune)
- [macOS 27 compiled-binary failure](https://github.com/oven-sh/bun/issues/39764)
- [merged Mach-O signing fix](https://github.com/oven-sh/bun/pull/39837)
- [`setup-bun` official action](https://github.com/oven-sh/setup-bun)
