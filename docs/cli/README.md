# CLI Docs

The local CLI imports, searches, opens, backs up, and exposes RecallBase data to local agents.

## Code Map

- Entry point: `apps/cli/src/cli.ts`
- Commands: `apps/cli/src/commands/*`
- Local importers: Codex CLI and Codex in the ChatGPT desktop app, Claude Code, Claude Web exports, GitHub Copilot, Grok Build, Kimi Code, and OpenCode under `packages/importers/src/*`
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

Search normalizes result limits to 10 by default and 50 at most for both CLI and MCP callers. Each result's `matchedMessageId` can be passed to `open` with a context radius from 0 to 5. A message-scoped open returns only that evidence window while preserving the conversation's full `messageCount`; an unscoped open remains unchanged.

## Codex Import Boundary

The `codex` source supports OpenAI Codex CLI and Codex tasks created in the [ChatGPT desktop app](https://developers.openai.com/). OpenAI now distributes the desktop experience as ChatGPT, with Codex integrated as its coding agent. These Codex surfaces use the local JSONL sessions under `~/.codex/sessions/` and `~/.codex/archived_sessions/`, so RecallBase imports them through one source adapter. It also reads `history.jsonl` and `session_index.jsonl` when present to recover user-facing task titles.

RecallBase imports user, assistant, system, and tool messages. Runtime-only records without importable messages are skipped and reported through bounded diagnostics.

## Grok Build Import Boundary

The `grok-build` source reads the official local session layout under `$GROK_HOME/sessions/` (default `~/.grok/sessions/`). It uses `summary.json` for session metadata and the authoritative ACP `updates.jsonl` stream for ordered conversation content. Grok Build uses the same files for TUI, headless, and ACP sessions.

RecallBase imports only user-visible `user_message_chunk` and `agent_message_chunk` text. It excludes thought chunks, tool inputs and outputs, hooks, plans, tasks, system prompts, file snapshots, and derived search indexes. Each session is streamed in its own database batch, and an incomplete trailing JSONL record from an active write is skipped without discarding the complete history before it.

## Kimi Code Import Boundary

The `kimi-code` source reads the documented main-agent session files under `$KIMI_CODE_HOME/sessions/` (default `~/.kimi-code/sessions/`). It imports user-visible prompts, assistant-visible text, session title and timestamps, workspace directory, archive state, and model identifiers.

It intentionally excludes private thinking, tool arguments and results, subagent streams, internal injections, system prompts, tool schemas, usage events, logs, tasks, and credentials. Those records are execution or diagnostic data rather than useful conversation history, and indexing them would add noise and increase privacy risk.

Discovery reads only bounded schema prefixes. Import streams `wire.jsonl`, discards irrelevant records immediately, and yields one session per database batch so peak memory follows useful transcript size rather than total raw history size.
