# Release Platforms

RecallBase's preferred install experience should mirror Codex CLI: package-manager install for most users, Homebrew cask on macOS, and direct GitHub Release binaries for users who want explicit artifacts.

```bash
npm install -g recallbase
brew install --cask recallbase
```

Each GitHub Release includes platform tarballs named `recallbase-<platform>-<version>.tar.gz`. Extract the right tarball and put `rb` on your `PATH`.

The release script packages Bun-compiled CLI targets. npm uses the Codex CLI pattern: `recallbase@<version>` is the command shim, and platform binaries are published as platform-suffixed versions of the same `recallbase` package. The shim references those versions through npm alias optional dependencies such as `recallbase-darwin-arm64: npm:recallbase@<version>-darwin-arm64`.

## Required Smoke Checks

Before publishing a binary target:

```bash
bun install
bun run typecheck
bun test tests/packaging
bun run package:release:test
bun run scripts/package-npm.ts --targets=host
tar -tzf .artifacts/release/<test-version>/recallbase-<platform>-<test-version>.tar.gz
```

Browser extension packages are released separately from a sibling project. The CLI installation step for extension users is the native-host setup command, not an extension release artifact:

```bash
rb extension install-host
rb extension verify-host
```

Firefox native-host compatibility: plain `rb extension install-host` must default to Firefox Extension 0.1.1 add-on ID `recallbase-capture@recallbase.net`. Use `RECALLBASE_FIREFOX_EXTENSION_ID` only for alternate or development Firefox builds.

Once fixture data exists, release smoke must also run:

```bash
rb sources --json
rb today --json
rb search "fixture" --json
rb open <fixture-conversation-id> --json
rb backup --out recallbase-backup.json --json
```

## Supported Targets

- Development target: current macOS arm64 with Bun `1.3.11`.
- CI smoke targets: Linux latest and macOS latest.
- GitHub Release CLI targets: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, and `win32-x64`.
- npm targets: one package, `recallbase`, with the public version plus platform versions such as `0.1.0-darwin-arm64`, `0.1.0-linux-x64`, and `0.1.0-win32-x64`.
- Native-host install targets: macOS user manifest directories, Linux user manifest directories, and Windows HKCU registry registration with compiled `rb.exe`.
- Source fallback target: any platform that can run Bun and install the package source.

## Publishing Notes

`recallbase` is available on npm as of May 22, 2026. npm publishing uses Trusted Publishing/OIDC, not a long-lived npm token. The package follows the Codex CLI pattern: `recallbase@0.1.0` is the command shim, and platform binaries are separate versions of the same package referenced through npm alias optional dependencies.

The trusted publisher for `recallbase` is configured as:

- Publisher: GitHub Actions
- Organization/user: `DarinRowe`
- Repository: `RecallBase`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

Run the `Release` workflow manually with `version=v<package-version>` and `publish_npm=true`. The workflow uses Node 24, npm 11+, and `id-token: write` to publish platform versions first, then the `recallbase` shim version. Platform versions are published with per-target dist-tags (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `win32-x64`); the shim version is published as `latest`.

The current npm dist-tags should look like:

```text
latest        -> 0.1.0
darwin-arm64  -> 0.1.0-darwin-arm64
darwin-x64    -> 0.1.0-darwin-x64
linux-arm64   -> 0.1.0-linux-arm64
linux-x64     -> 0.1.0-linux-x64
win32-x64     -> 0.1.0-win32-x64
```

The first npm publish was completed manually with a short-lived token because npm requires an existing package before Trusted Publishing can be configured. Future publishes should use the workflow path above.

For Homebrew:

1. Create a tap repository such as `DarinRowe/homebrew-tap`.
2. Save a token with write access to that repo as `HOMEBREW_TAP_TOKEN`.
3. Run the `Release` workflow with `homebrew_tap_repo=<owner>/<tap-repo>`.
4. The workflow writes `Casks/recallbase.rb` from the GitHub Release manifest and pushes it to the tap.

Manual release packaging commands:

```bash
bun run scripts/package-release.ts --version=v0.1.0 --cli-targets=all
bun run scripts/package-npm.ts --version=0.1.0 --targets=all
bun run scripts/package-homebrew.ts --version=v0.1.0 --repo=DarinRowe/RecallBase
```

## Known Limits

- SQLite/FTS is a hard requirement. If the compiled binary cannot create an FTS5 table, use the package-manager fallback for that platform.
