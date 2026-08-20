# Agent Integration

RecallBase's canonical Agent contract is local CLI JSON over imported conversation data. MCP is optional and mirrors the same query layer.

The publishable runtime instructions live in [`../../skills/recallbase/`](../../skills/recallbase/). Keep retrieval workflow, result interpretation, troubleshooting, and MCP guidance there so installed skills and repository behavior share one source of truth.

## Maintainer contract

- Update the runtime skill whenever CLI commands, JSON shapes, or command semantics change.
- Keep the public website Docs MCP separate from local history access through `rb mcp`.
- Preserve customer-facing synthesis: retrieved data supports the answer; raw IDs, JSON, and transcripts are not the answer.
- Preserve local-first operation and privacy-safe diagnostics.

The fixture-backed integration test at `tests/integration/agent-access.test.ts` validates that every bundled skill reference resolves and that the documented `sources`, `today`, `search`, and `open` flow remains executable.

The repository root is also a Claude Code plugin. Its `.claude-plugin/plugin.json` points Claude Code at the canonical `skills/` directory, so Claude Code, GitHub CLI, and `npx skills` share the same `SKILL.md` and references instead of maintaining copies. Validate the package from the repository root with `claude plugin validate .` and `gh skill publish --dry-run` before marketplace submission or release.

The root `gemini-extension.json` exposes that same canonical directory to Gemini CLI. Validate it with `gemini extensions validate .` before release. Registries that accept only one Markdown file use the generated `distributions/recallbase.skill.md`; rebuild it with `bun run package:agent-skill` and verify it with `bun run package:agent-skill:check` so the distribution cannot drift from the canonical Skill and references.

For isolated MCP smoke tests, use `config/mcp-inspector.json`. It uses `:memory:` and `--no-refresh`, so it never reads or imports the user's real RecallBase history.
