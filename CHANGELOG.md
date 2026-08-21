# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/DarinRowe/RecallBase/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/DarinRowe/RecallBase/compare/v0.1.3...v0.1.4
[0.1.0]: https://github.com/DarinRowe/RecallBase/releases/tag/v0.1.0
