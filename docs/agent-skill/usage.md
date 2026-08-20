# Agent Integration

RecallBase's canonical Agent contract is local CLI JSON over imported conversation data. MCP is optional and mirrors the same query layer.

The publishable runtime instructions live in [`../../agent/recallbase/`](../../agent/recallbase/). Keep retrieval workflow, result interpretation, troubleshooting, and MCP guidance there so installed skills and repository behavior share one source of truth.

## Maintainer contract

- Update the runtime skill whenever CLI commands, JSON shapes, or command semantics change.
- Keep the public website Docs MCP separate from local history access through `rb mcp`.
- Preserve customer-facing synthesis: retrieved data supports the answer; raw IDs, JSON, and transcripts are not the answer.
- Preserve local-first operation and privacy-safe diagnostics.

The fixture-backed integration test at `tests/integration/agent-access.test.ts` validates that every bundled skill reference resolves and that the documented `sources`, `today`, `search`, and `open` flow remains executable.

For isolated MCP smoke tests, use `config/mcp-inspector.json`. It uses `:memory:` and `--no-refresh`, so it never reads or imports the user's real RecallBase history.
