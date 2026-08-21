# Troubleshooting

Read this file when the CLI is unavailable, results are empty or incomplete, imports fail, or browser-extension capture is unhealthy.

## CLI and source coverage

1. Run `rb --version` to confirm which local release is active.
2. Run `rb sources --json` and inspect health, counts, import times, and diagnostics.
3. Run `rb import --json` when known local sources have not been imported. It skips unchanged sources; use `rb import --force --json` only when a full re-import is required. `today` and non-empty `search` queries normally refresh known default sources automatically; explicit database paths, explicit roots, and `--no-refresh` suppress that refresh.
4. Retry the narrow query. Stop when results are available or the source status identifies the missing coverage.

For Cursor, the source ID is `cursor` and the default data root is `~/.cursor/projects/`. RecallBase reads only main files matching `*/agent-transcripts/<conversation-id>/<conversation-id>.jsonl`, deduplicates repeated conversation IDs, and excludes `subagents/`, thinking, tools, status/error records, terminal/file content, opaque CLI blobs, Desktop application state, derived search indexes, and cloud/background history. Automatic coverage is currently verified on macOS Cursor Desktop 3.15.6 and Agent CLI 2026.08.04; a `cursor_transcript_invalid` or `cursor_schema_unknown` diagnostic means the observed internal transcript schema needs compatibility review. For another verified transcript root or one exact main transcript, run `rb import --source cursor --root <path> --json`.

For Kimi Code, the source ID is `kimi-code` and the default data root is `~/.kimi-code/` (or `$KIMI_CODE_HOME`). RecallBase reads `sessions/*/*/state.json` and `sessions/*/*/agents/main/wire.jsonl`; it does not use the legacy `~/.kimi/` tree. It indexes the user-visible main-agent conversation and excludes private thinking, tool payloads, subagent streams, and internal injections.

For Grok Build, the source ID is `grok-build` and the default data root is `~/.grok/` (or `$GROK_HOME`). RecallBase reads `sessions/*/*/summary.json` and the authoritative `sessions/*/*/updates.jsonl` stream. It indexes user-visible user/agent message chunks and excludes thoughts, tool payloads, hooks, plans, tasks, system prompts, file snapshots, and derived search indexes.

For Pi, the source ID is `pi` and the default data root is `~/.pi/agent/sessions/`. RecallBase honors `$PI_CODING_AGENT_SESSION_DIR`, `$PI_CODING_AGENT_DIR`, and the global Pi `settings.json` `sessionDir` value. It reads released v1-v3 session JSONL trees, follows the explicit leaf when present, indexes user/assistant text on that branch, and excludes thinking, tools, bash output, summaries, abandoned branches, extension messages, and file/image contents. For another custom layout, run `rb import --source pi --root <session-dir> --json`. A `pi_session_version_unsupported` diagnostic means Pi wrote the newer lane-based v4 format, which requires a compatible RecallBase update.

If `rb` is not installed, report that prerequisite. Install it only within the user's authorization; the standard package command is `npm install -g recallbase`.

## Browser capture

Use the read-only check first:

```bash
rb extension verify-host --json
```

If setup is missing or stale and the user wants it repaired, run:

```bash
rb extension install-host --json
```

Installation changes per-user browser native-host configuration. It supports Chrome, Chrome for Testing on macOS/Linux, Edge, and Firefox. `RECALLBASE_CHROME_EXTENSION_ID` adds one exact alternate Chromium ID; `RECALLBASE_FIREFOX_EXTENSION_ID` replaces the default Firefox ID for alternate builds.

## Safe diagnostics

Use structured error codes, short messages, and actionable hints. Keep user-facing diagnostics free of local database paths, secrets, raw DOM, API payloads, headers, cookies, tokens, full URL queries, clipboard contents, and conversation text.
