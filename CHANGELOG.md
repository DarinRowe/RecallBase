# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Open source release preparation: MIT license, contributing guidelines, security policy, and code of conduct.

## [0.1.0] - 2026-05-22

### Added

- Local-first CLI `rb` for importing, searching, and recalling AI conversation history.
- Importers for OpenAI Codex CLI, Claude Code, GitHub Copilot, opencode, ChatGPT/Claude web exports, and browser extension captures.
- SQLite-backed local store with full-text search and conversation encryption.
- MCP server exposing `today`, `search`, `open`, `sources`, and `sync_status` tools.
- Optional Cloudflare-based sync with Hybrid Private Mode: encrypted conversation chunks plus bounded readable search metadata.
- Web viewer for synced data.
- Browser extension native messaging host support.

[Unreleased]: https://github.com/DarinRowe/RecallBase/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DarinRowe/RecallBase/releases/tag/v0.1.0
