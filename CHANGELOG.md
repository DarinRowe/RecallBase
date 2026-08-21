# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- GitHub Release notes are now generated from the matching changelog version, and stable packaging fails when that entry is missing or empty.

## [0.1.7] - 2026-08-21

### Added

- Added local Pi session import for released v1-v3 JSONL histories with active-branch reconstruction, incremental updates, and official path overrides.
- Added first-party Pi interface research, sanitized fixtures, legacy format coverage, explicit leaf handling, and diagnostics for the incompatible unreleased v4 schema.

### Security

- Pi imports exclude reasoning, tools, shell output, summaries, abandoned branches, and extension messages; file inputs and images are reduced to safe placeholders.

## [0.1.6] - 2026-08-20

### Fixed

- Native-host source installs on macOS and Linux now pin absolute Bun and CLI paths so GUI-launched browsers do not depend on the user's shell `PATH`.
- Windows compiled executables now recognize Bun's Windows virtual entry path when installing the native messaging host.

### Changed

- npm packages now declare the Node 18+ shim requirement and glibc-only Linux prebuilt boundary explicitly.
- CI and release smoke now validate the compiled Windows native-host installation path.

## [0.1.5] - 2026-08-20

### Added

- Added local Grok Build session import from official `updates.jsonl` history while excluding hidden subagents, reasoning, tool payloads, and reverted events.
- Added bounded evidence retrieval around a matched message through `rb open --message <id> --context <0-5>` and the equivalent MCP parameters.

### Changed

- Search snippets now favor windows containing more query terms, and search limits share one validated 1-50 contract across CLI, MCP, and core queries.
- The RecallBase agent skill now follows a narrower query ladder and opens bounded evidence before full conversations.
- CLI subcommand help no longer initializes the local database.

## [0.1.4] - 2026-08-20

### Changed

- Search now preserves Unicode queries and fills token-search gaps with a constrained substring pass.
- Source-filtered search responses now return coverage for the selected source only.
- Large CLI JSON responses now flush completely before the process exits.

### Added

- Added local Kimi Code history import with visible conversation text only; tool payloads, reasoning, and system context remain excluded.

## [0.1.0] - 2026-05-22

### Added

- Local-first CLI `rb` for importing, searching, and recalling AI conversation history.
- Importers for OpenAI Codex CLI, Claude Code, GitHub Copilot, OpenCode, ChatGPT/Claude web exports, and browser extension captures.
- SQLite-backed local store with full-text search.
- MCP server exposing `today`, `search`, `open`, and `sources` tools.
- Browser extension native messaging host support.

[Unreleased]: https://github.com/DarinRowe/RecallBase/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/DarinRowe/RecallBase/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/DarinRowe/RecallBase/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/DarinRowe/RecallBase/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/DarinRowe/RecallBase/compare/v0.1.3...v0.1.4
[0.1.0]: https://github.com/DarinRowe/RecallBase/releases/tag/v0.1.0
