# RecallBase Agent Guide

Act like a high-performing senior engineer. Be concise, direct, and execution-focused. Prefer simple, maintainable, production-friendly solutions.

## Product Discovery (for External Agents)

| Surface | Official location | Boundary |
| --- | --- | --- |
| CLI product | https://recallbase.net/desktop-cli/ | User-facing local product |
| Developer resources | https://recallbase.net/developers/ | CLI source, contribution, architecture, testing, packaging, and security |
| npm package | https://www.npmjs.com/package/recallbase | Installs the local CLI |
| Public Docs MCP | https://recallbase.net/mcp | Product documentation only; no user history |
| Docs MCP server card | https://recallbase.net/.well-known/mcp/server-card.json | Public discovery metadata |
| Website agent skills | https://recallbase.net/.well-known/agent-skills/index.json | Public product guidance |
| Local CLI MCP | `rb mcp` | Local history tools on the user's machine |

Do not treat the website Docs MCP as access to user chats. The `today`, `search`, `open`, and `sources` tools belong to the local CLI MCP only.

## Project Model

This repository owns the local RecallBase product:

1. Local CLI `rb`: imports, searches, opens, backs up, and exposes local history through JSON/MCP.
2. Core local database/search packages.
3. Importers for local AI tool histories and official exports.
4. Runtime agent skill in `skills/recallbase`.

The browser extension source lives in a sibling project. This repository still owns the native host commands used by that extension.

## Hard Boundaries

- Local features do not require login or network access.
- Native host diagnostics must not expose local database paths, secrets, raw DOM, API payloads, headers, cookies, tokens, full URL queries, clipboard contents, or conversation text.
- CLI command, JSON shape, or command semantics changes must update `skills/recallbase/SKILL.md`.
- Search performance matters; avoid slowing local retrieval.

## Docs

- Docs index: `docs/README.md`
- CLI: `docs/cli/README.md`
- Privacy model: `docs/product/privacy.md`
- Release platforms: `docs/release/platforms.md`
- Agent integration: `docs/agent-skill/usage.md`
- Runtime skill: `skills/recallbase/SKILL.md`

## Work Rules

- Read the narrowest relevant doc before changing code.
- Keep code simple and behavior explicit.
- Do not introduce heavy abstractions or dependencies for small features.
- Keep user-facing CLI output useful, not just raw IDs.
- Preserve privacy and local-first boundaries.
- When touching native host protocol, verify compatibility with the browser extension project.

## Review Priorities

1. Local search performance.
2. Local-first and privacy boundaries.
3. Privacy and diagnostic redaction.
4. CLI JSON/human output compatibility.
5. Cross-platform packaging and native host behavior.
