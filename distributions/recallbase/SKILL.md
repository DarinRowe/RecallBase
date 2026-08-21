---
name: recallbase
description: Recover evidence from local AI conversation history with RecallBase. Use for same-day work summaries, resuming prior sessions, or finding a past recommendation or decision and its source.
license: MIT
metadata:
  author: Darin Rowe
---

# RecallBase

Recover the smallest useful slice of local AI history, then answer the user's question in natural language.

This workflow requires the local `rb` CLI on `PATH` and a RecallBase store populated from supported local sources. Core retrieval runs locally without login or network access.

## Retrieve

1. Choose the narrowest entry point:
   - Same-day continuity: `rb today --json`
   - A known topic, error, file, branch, command, or decision: `rb search "<specific query>" --json`
   - Suspected coverage gaps: `rb sources --json`
2. Apply user-supplied source and date constraints immediately. Start with the user's exact language. If it misses, use a query ladder: core concept, then known UI label, filename, command, or code identifier. Expand one dimension at a time and retain the constraints.
3. Inspect the JSON envelope. Continue only from `ok: true`; for `ok: false`, use `error.code`, `message`, and `hint` to explain or recover.
4. Open only the strongest candidate conversations with `rb open <conversation-id> --json`. Search results also provide the stable reference `recallbase:conversation/<id>`.

Search results are candidates; opened messages are evidence. An incidental implementation mention does not establish a recommendation or decision.

Retrieval is complete when the evidence answers the question or the available source coverage proves the relevant history is absent or incomplete.

Use an already-configured local RecallBase MCP instead of shell commands when it is available. Read [references/mcp.md](#local-mcp) for MCP routing. The public RecallBase Docs MCP contains product documentation; personal history tools come only from the local `rb mcp` server.

## Synthesize

- Answer the request directly. For a daily recap, group work into themes and name concrete tasks, outcomes, decisions, tests, merged changes, and visible next steps.
- Treat conversation IDs and `rb open ...` commands as optional follow-up references, not the answer.
- Summarize the relevant messages instead of reproducing full transcripts or raw JSON.
- State material coverage gaps when sources are absent, partial, failed, or stale. When no evidence supports a claim, say so.

The response is complete when every material claim is grounded in retrieved history, uncertainty is explicit, and the user can continue without reading command output.

## Conditional references

- Read [references/results.md](#result-reference) when interpreting unfamiliar fields or building against the JSON contract.
- Read [references/troubleshooting.md](#troubleshooting) when `rb` is unavailable, retrieval is empty or incomplete, imports fail, a full re-import is required, or browser capture setup is unhealthy.

---

# Local MCP

Read this file when local RecallBase MCP tools are already available or the user asks to configure or diagnose MCP.

The local server mirrors the CLI query layer with four tools: `today`, `search`, `open`, and `sources`. Apply the same retrieve-then-synthesize workflow from `SKILL.md`; tool results do not change the answer quality bar.

Configure clients to launch the local stdio server:

```json
{
  "mcpServers": {
    "recallbase": {
      "command": "rb",
      "args": ["mcp"]
    }
  }
}
```

The server uses the MCP `2024-11-05` stdio profile. A tool result with `isError: true` contains a failed RecallBase envelope; inspect its `error.code`, `message`, and optional `hint`.

The website Docs MCP is a separate public documentation service and has no access to local conversation history.

---

# Result reference

Read this file when a RecallBase result contains unfamiliar fields or when an integration depends on the JSON contract.

## Envelope

Every CLI JSON response is one of:

- Success: `ok: true`, `meta`, and `data`
- Failure: `ok: false`, `meta`, and `error`

`meta.schemaVersion` is currently `1`. Warnings and source diagnostics can qualify an otherwise successful result.

## Query results

- `today`: `date`, a compact `summary`, `keySessions`, `continuationHints`, and `sourceCoverage`. Open the most relevant key sessions when the summary is too terse to support a useful answer.
- `search`: the normalized `query`, applied `filters`, ranked `results`, and `sourceCoverage`. Each result includes an `id`, `sourceId`, title, timestamps, snippet when available, score, and stable `uri`.
- `open`: conversation metadata, ordered `messages`, `rawEvidenceRefs`, and `diagnostics`.
- `sources`: per-source health, confidence, import time, counts, and diagnostics.

Message `text` is the main content. Optional `thinking` contains platform-visible reasoning and remains distinct from `text`. Optional `modelId`, `upstreamIds`, `attachments`, `citations`, and `media` are supporting context. Attachment and media URLs are sanitized and may omit token-like query details.

RecallBase imports are message-first. A healthy source can report `rawEvidence: 0`; judge coverage primarily from conversations, messages, health, and diagnostics.

## Useful filters

Narrow targeted searches when the user supplies the constraint:

```bash
rb search "<query>" --json --source <source-id>
rb search "<query>" --json --date YYYY-MM-DD
rb search "<query>" --json --limit <count>
```

Prefer a precise query containing distinctive nouns, exact errors, filenames, commands, or decision language. Broaden only after a narrow search fails.

Read ranked results first. Inspect `sourceCoverage` when results are empty, incomplete, or need a coverage qualification.

---

# Troubleshooting

Read this file when the CLI is unavailable, results are empty or incomplete, imports fail, or browser-extension capture is unhealthy.

## CLI and source coverage

1. Run `rb --version` to confirm which local release is active.
2. Run `rb sources --json` and inspect health, counts, import times, and diagnostics.
3. Run `rb import --json` when known local sources have not been imported. It skips unchanged sources; use `rb import --force --json` only when a full re-import is required. `today` and non-empty `search` queries normally refresh known default sources automatically; explicit database paths, explicit roots, and `--no-refresh` suppress that refresh.
4. Retry the narrow query. Stop when results are available or the source status identifies the missing coverage.

For Kimi Code, the source ID is `kimi-code` and the default data root is `~/.kimi-code/` (or `$KIMI_CODE_HOME`). RecallBase reads `sessions/*/*/state.json` and `sessions/*/*/agents/main/wire.jsonl`; it does not use the legacy `~/.kimi/` tree. It indexes the user-visible main-agent conversation and excludes private thinking, tool payloads, subagent streams, and internal injections.

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
