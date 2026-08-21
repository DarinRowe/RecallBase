# Release Platforms

RecallBase's preferred install experience is npm for most users, a checksum-verifying installer on Linux, and direct GitHub Release binaries for users who want explicit artifacts.

```bash
npm install -g recallbase
curl -fsSL https://github.com/DarinRowe/RecallBase/releases/latest/download/install-linux.sh | bash
```

Each GitHub Release includes `install-linux.sh` and platform tarballs named `recallbase-<platform>-<version>.tar.gz`. The Linux installer detects x86_64 or ARM64 glibc, verifies the selected archive against `checksums.sha256`, installs `rb` to `~/.local/bin` by default, and runs `rb --version` before reporting success. Set `RB_VERSION=v<version>` to pin a release, `RB_INSTALL_DIR` to select a destination, or `RB_NO_MODIFY_PATH=1` to leave shell profiles unchanged.

The release script packages Bun-compiled CLI targets. npm uses the Codex CLI pattern: `recallbase@<version>` is a Node 18+ command shim, and platform binaries are published as platform-suffixed versions of the same `recallbase` package. The shim references those versions through npm alias optional dependencies such as `recallbase-darwin-arm64: npm:recallbase@<version>-darwin-arm64`; the platform binary embeds Bun, so npm users do not need a separate Bun installation.

All npm artifacts copy the repository root `README.md` into the package root. Keep package documentation in that single source; npm displays the copied README after the next version is published.

## Required Smoke Checks

Before publishing a binary target:

```bash
bun install
bun run typecheck
bun test tests/packaging
bun run package:release:test
bun run scripts/package-npm.ts --targets=host
bash -n scripts/install-linux.sh
tar -tzf .artifacts/release/<test-version>/recallbase-<platform>-<test-version>.tar.gz
```

Browser extension packages are released separately from a sibling project. The CLI installation step for extension users is the native-host setup command, not an extension release artifact:

```bash
rb extension install-host
rb extension verify-host
```

Native-host compatibility: plain `rb extension install-host` must allow Chrome Web Store ID `fapgpimjelmfedlapidmfljcpmenmjeb`, Microsoft Edge Add-ons ID `gnlcemcmimkbgmnlclipknjjghllfdac`, development Chromium ID `hagfpddjfmcfjnjghjogkibjilmkgfih`, and Firefox add-on ID `recallbase-capture@recallbase.net`. Chrome, Chromium, Edge, and Firefox are built-in targets. On macOS, installed Chromium browser bundles are discovered through either a safe `CrProductDirName` plus `org.chromium.extension` check, or a web-browser bundle with a matching established Chromium user-data root containing `Local State`, profile preferences, and extension storage. Linux discovers the same established profile shape below `CHROME_CONFIG_HOME`, `XDG_CONFIG_HOME`, or `~/.config`, in that precedence order. Windows adds safe HKCU browser registry roots that already contain `NativeMessagingHosts`, alongside the standard Chrome, Chromium, Edge, and Mozilla keys. Every discovered target is deduplicated against built-in registrations and installed or verified in the same command. Electron applications without an extension-capable browser profile are not browser targets. Unknown Chromium forks use a universal explicit fallback: `--chromium-user-data-dir <absolute-path>` on macOS/Linux or `--chromium-registry-root <HKCU-key>` on Windows. `install-host` persists those validated targets in `~/.recallbase/extension-host-targets.json`, and later plain `verify-host` calls must include them. Used alone, `--clear-chromium-targets` clears the saved custom set; when combined with explicit flags it replaces the set. Previously explicit Windows roots remain ignored after clearing without destructively deleting registry keys. Installed official Firefox channels must be reported individually while sharing Mozilla's single per-user manifest path. `RECALLBASE_CHROME_EXTENSION_ID` adds an exact alternate Chromium ID; `RECALLBASE_FIREFOX_EXTENSION_ID` replaces the Firefox default. POSIX source installs must pin the absolute runtime and entry paths in the host wrapper so GUI-launched browsers do not depend on the user's shell `PATH`. Release smoke must require `verify-host` to exit nonzero for missing, newly detected, saved custom, or stale setup and zero only after every resolved manifest is current and the installed host answers the v1 health request with a minimal system `PATH`.

Once fixture data exists, release smoke must also run:

```bash
rb sources --json
rb today --json
rb search "fixture" --json
rb open <fixture-conversation-id> --json
rb backup --out recallbase-backup.json --json
```

## Supported Targets

- Development target: current macOS arm64 with Bun `1.3.14`.
- Release smoke targets: Linux latest, macOS latest, and Windows latest.
- Native-host CI targets: real compiled host installs on macOS latest, Windows latest, and Linux latest, plus POSIX source-host execution with a GUI-safe `PATH`.
- GitHub Release and npm publishing are gated on executing each exact packaged native-host binary and the user-facing npm shim on Linux x64/arm64, macOS Intel/Apple Silicon, and Windows x64 runners.
- GitHub Release CLI targets: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, and `win32-x64`.
- npm targets: one package, `recallbase`, with the public version plus platform versions such as `0.1.7-darwin-arm64`, `0.1.7-linux-x64`, and `0.1.7-win32-x64`.
- Native-host install targets: Chrome, Chromium, Microsoft Edge, and Firefox per-user locations on macOS/Linux/Windows; Chrome for Testing per-user locations on macOS/Linux; safely auto-discovered Chromium profile directories on macOS/Linux; standard plus already-established browser-specific Windows HKCU registrations with compiled `rb.exe`; and persistent explicit user-data/registry targets for every Chromium fork whose product-specific location cannot be inferred safely.
- Linux prebuilt targets require glibc. musl/Alpine users must currently run the package source with Bun; do not route them to the glibc binary.
- Source fallback target: any platform that can run Bun 1.3.14 and satisfy the SQLite/FTS requirement.

## Publishing Notes

`recallbase` is available on npm as of May 22, 2026. npm publishing uses Trusted Publishing/OIDC, not a long-lived npm token. The package follows the Codex CLI pattern: `recallbase@0.1.7` is the command shim, and platform binaries are separate versions of the same package referenced through npm alias optional dependencies.

The trusted publisher for `recallbase` is configured as:

- Publisher: GitHub Actions
- Organization/user: `DarinRowe`
- Repository: `RecallBase`
- Workflow filename: `release.yml`
- Allowed action: `npm publish`

Run the `Release` workflow manually with `version=v<package-version>` and `publish_npm=true`. The workflow uses Node 24, npm 11+, and `id-token: write` to publish platform versions first, then the `recallbase` shim version. Platform versions are published with per-target dist-tags (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `win32-x64`); the shim version is published as `latest`.

`CHANGELOG.md` is the single source for user-facing changes. Stable packaging extracts the exact `## [<package-version>]` section into the GitHub Release notes and fails before publishing when that section is missing or empty. Test releases keep generic dogfooding notes and do not require a versioned changelog entry.

The current npm dist-tags should look like:

```text
latest        -> 0.1.7
darwin-arm64  -> 0.1.7-darwin-arm64
darwin-x64    -> 0.1.7-darwin-x64
linux-arm64   -> 0.1.7-linux-arm64
linux-x64     -> 0.1.7-linux-x64
win32-x64     -> 0.1.7-win32-x64
```

The first npm publish was completed manually with a short-lived token because npm requires an existing package before Trusted Publishing can be configured. Future publishes should use the workflow path above.

Homebrew distribution is not public yet. Do not advertise a `brew install` command until an official tap exists and the command has been tested from a clean machine. The repository retains cask generation for that future rollout:

1. Create a tap repository such as `DarinRowe/homebrew-tap`.
2. Save a token with write access to that repo as `HOMEBREW_TAP_TOKEN`.
3. Run the `Release` workflow with `homebrew_tap_repo=<owner>/<tap-repo>`.
4. The workflow writes `Casks/recallbase.rb` from the GitHub Release manifest and pushes it to the tap.

Manual release packaging commands:

```bash
bun run scripts/package-release.ts --version=v0.1.7 --cli-targets=all
bun run scripts/package-npm.ts --version=0.1.7 --targets=all
bun run scripts/package-homebrew.ts --version=v0.1.7 --repo=DarinRowe/RecallBase
```

## Known Limits

- SQLite/FTS is a hard requirement. If the compiled binary cannot create an FTS5 table, use the package-manager fallback for that platform.
