# RecallBase Agent Guide

Act like a high-performing senior engineer. Be concise, direct, and execution-focused. Prefer simple, maintainable, production-friendly solutions.

## Project Model

This repository owns the local RecallBase product:

1. Local CLI `rb`: imports, searches, opens, backs up, and exposes local history through JSON/MCP.
2. Core local database/search packages.
3. Importers for local AI tool histories and official exports.
4. Runtime agent skill in `agent/recallbase`.

The browser extension source lives in sibling `../RecallBase-Extension`. This repository still owns the native host commands used by that extension.

## Hard Boundaries

- Local features do not require login or network access.
- Native host diagnostics must not expose local database paths, secrets, raw DOM, API payloads, headers, cookies, tokens, full URL queries, clipboard contents, or conversation text.
- CLI command, JSON shape, or command semantics changes must update `agent/recallbase/SKILL.md`.
- When CLI commands, JSON shapes, or command semantics change, update `agent/recallbase/SKILL.md` accordingly.
- Search performance matters; avoid slowing local retrieval.

## Docs

- Docs index: `docs/README.md`
- CLI: `docs/cli/README.md`
- Privacy model: `docs/product/privacy.md`
- Release platforms: `docs/release/platforms.md`
- Agent integration: `docs/agent-skill/usage.md`
- Runtime skill: `agent/recallbase/SKILL.md`

## Work Rules

- Read the narrowest relevant doc before changing code.
- Keep code simple and behavior explicit.
- Do not introduce heavy abstractions or dependencies for small features.
- Keep user-facing CLI output useful, not just raw IDs.
- Preserve privacy and local-first boundaries.
- When touching native host protocol, verify compatibility with `../RecallBase-Extension`.

## Review Priorities

1. Local search performance.
2. Local-first and privacy boundaries.
3. Privacy and diagnostic redaction.
4. CLI JSON/human output compatibility.
5. Cross-platform packaging and native host behavior.
