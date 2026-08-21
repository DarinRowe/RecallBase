# CLI Docs

The local CLI imports, searches, opens, backs up, and exposes RecallBase data to local agents.

## Code Map

- Entry point: `apps/cli/src/cli.ts`
- Commands: `apps/cli/src/commands/*`
- Local importers: Codex, Claude Code, Claude Web exports, GitHub Copilot, Kimi Code, and OpenCode under `packages/importers/src/*`
- Native browser bridge: `apps/cli/src/commands/extension-host.ts`
- Native host install/verify: `apps/cli/src/commands/extension-install.ts`
- MCP server: `apps/cli/src/mcp/*`
- Human and JSON output: `apps/cli/src/output/*`

## Related Docs

- Agent integration: `../agent-skill/usage.md`
- Release packaging: `../release/platforms.md`
- Runtime agent skill: `../../skills/recallbase/SKILL.md`
- Browser extension project: sibling project outside this repository

When CLI commands, JSON shape, or command semantics change, update `../../skills/recallbase/SKILL.md`.

## Search Boundary

Search preserves Unicode text and uses the existing FTS ranking first. When token matching does not fill the requested result set, RecallBase performs a bounded substring pass with the same source and date constraints. This keeps common searches fast while supporting writing systems without whitespace-delimited words and partial terms without a language-specific tokenizer or external dependency.

## Kimi Code Import Boundary

The `kimi-code` source reads the documented main-agent session files under `$KIMI_CODE_HOME/sessions/` (default `~/.kimi-code/sessions/`). It imports user-visible prompts, assistant-visible text, session title and timestamps, workspace directory, archive state, and model identifiers.

It intentionally excludes private thinking, tool arguments and results, subagent streams, internal injections, system prompts, tool schemas, usage events, logs, tasks, and credentials. Those records are execution or diagnostic data rather than useful conversation history, and indexing them would add noise and increase privacy risk.

Discovery reads only bounded schema prefixes. Import streams `wire.jsonl`, discards irrelevant records immediately, and yields one session per database batch so peak memory follows useful transcript size rather than total raw history size.
