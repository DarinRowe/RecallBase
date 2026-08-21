# Kimi Code local history import research

Reviewed on 2026-08-20 against the official Kimi Code documentation and
`MoonshotAI/kimi-code` commit
[`30e7f62`](https://github.com/MoonshotAI/kimi-code/commit/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f).

## Decision

Build the first importer for the current Kimi Code format under
`$KIMI_CODE_HOME` (default `~/.kimi-code`). Import one RecallBase conversation
per Kimi session from `state.json` and `agents/main/wire.jsonl`. Import only:

- session id, title, working directory, created/updated time, archive state, and
  `forkedFrom`;
- direct user prompts (including compact reconstructions of user-invoked Skill
  and plugin slash commands); and
- user-visible assistant text, with media represented only by `[image]`,
  `[audio]`, or `[video]`.

Do **not** import tool invocations, tool results, thinking, system/injected
prompts, request traces, approvals, tasks, plans, cron state, logs, input
history, or subagent wires. This is both the smallest useful search corpus and
the safest one: Kimi documents the request trace as debugging data and warns
that exports may contain sensitive code, command output, and paths. The public
API also separates messages/transcripts from approvals, tasks, tools, and MCP
resources. [Sessions guide](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions.html#session-storage),
[export warning](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions.html#exporting-a-session),
[Server API resource split](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html#rest-endpoints).

## Storage and discovery

The current layout is:

```text
$KIMI_CODE_HOME/                       # default: ~/.kimi-code
├── session_index.jsonl
└── sessions/
    └── <workDirKey>/
        └── <sessionId>/
            ├── state.json
            └── agents/
                ├── main/wire.jsonl
                └── <subagentId>/wire.jsonl
```

Kimi documents the root override, cross-platform default, index, and session
layout in [Data locations](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/data-locations.html#data-root-directory).
`workDirKey` is `wd_<slug>_<12 hex chars>`; the source normalizes separators,
uses the working directory basename for the slug, and hashes the normalized
full path with SHA-256.
[`workdir-slug.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/_base/utils/workdir-slug.ts#L3-L22)

Discovery should walk `sessions/**/agents/main/wire.jsonl` and derive the
session directory from the match. Treat `session_index.jsonl` only as an
optional working-directory fallback, not as the authoritative file list. A
creation line has `{sessionId, sessionDir, workDir}`, but deletion appends a
`{sessionId, deleted: true}` tombstone after removing the session directory.
[`sessionLifecycleService.ts` creation](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/workspace/sessionLifecycle/sessionLifecycleService.ts#L289-L297),
[`sessionLifecycleService.ts` deletion](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/workspace/sessionLifecycle/sessionLifecycleService.ts#L425-L439).

Only read `agents/main/wire.jsonl`. The official layout explicitly assigns a
separate wire to every subagent; subagent execution is implementation detail
that can duplicate the main agent's eventual answer.
[Data locations: session data](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/data-locations.html#session-data).

## `state.json`

Current session metadata version 2 has these fields:

| Field | Shape | RecallBase use |
| --- | --- | --- |
| `id` | string | `upstreamId`; fall back to directory name |
| `title` | string, optional | preferred title |
| `lastPrompt` | string, optional | title fallback only; never add as a message |
| `createdAt`, `updatedAt` | epoch milliseconds in current files | conversation timestamps |
| `cwd` | string, optional | workspace metadata |
| `forkedFrom` | string, optional | provenance metadata |
| `archived`, `archivedAt` | boolean / epoch milliseconds | provenance metadata |
| `titleKind`, `isCustomTitle`, `lastTurnReason` | scalar metadata | no search text |
| `agents`, `custom` | nested open-ended metadata | skip |

The authoritative interface is
[`SessionMeta`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/session/sessionMetadata/sessionMetadata.ts#L13-L32),
and persistence adds `isCustomTitle`.
[`encodeSessionMeta`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/session/sessionMetadata/sessionMetadataService.ts#L293-L297)

For compatibility with sessions migrated inside `~/.kimi-code`, accept either
epoch numbers or parseable date strings for the two timestamps and accept
legacy `workDir` when `cwd` is absent; Kimi's own normalizer does the same.
[`normalizeSessionMeta`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/session/sessionMetadata/sessionMetadataService.ts#L231-L268),
[`toEpochMs`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/session/sessionMetadata/sessionMetadataService.ts#L310-L317).

## `wire.jsonl` schema

Each line is a JSON event with a string `type` and normally an epoch-millisecond
`time`. The first record is normally `metadata` with `protocol_version` and
`created_at`; the current protocol at the reviewed commit is `1.5`.
[`record.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/wire/record.ts#L12-L46),
[`migration.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/wire/migration/migration.ts#L19-L35).
Serialized durable events stamp `time` with `Date.now()` when no explicit time
was supplied.
[`event2.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/app/event/event2.ts#L22-L46)

The content model has roles `system`, `user`, `assistant`, and `tool`; content
parts are `text`, `think`, `image_url`, `audio_url`, and `video_url`. Assistant
messages separately carry `toolCalls`, and tool messages carry `toolCallId`.
[`message.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/kosong/contract/message.ts#L3-L58)

Only the following records matter to a conversation importer:

| Record | Relevant payload | Import behavior |
| --- | --- | --- |
| `metadata` | `protocol_version`, `created_at` | schema/fallback time only |
| `turn.prompt`, `turn.steer` | `input[]`, `origin` | normally skip because the same user input is persisted as `context.append_message`; use only as a recovery fallback for an unmatched, interrupted write |
| `context.append_message` | `message` | feed the transcript reducer; current user messages and legacy fully formed assistant messages arrive here |
| `context.append_loop_event` | `event` | reconstruct assistant steps from `step.begin` + `content.part` + `step.end` |
| `context.undo` | `count` | remove the last `count` user-anchored turns, without crossing the last clear/compaction boundary |
| `context.clear` | no content payload | keep earlier transcript entries but start a new undo floor |
| `context.apply_compaction` | summary and counts | settle an open step, but do not import the synthetic summary |
| everything else | config, tools, usage, goals, plans, requests, tasks, etc. | skip |

The durable context schemas are defined in
[`contextEvents.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/agent/contextMemory/contextEvents.ts#L9-L110).
Loop events have exact variants `step.begin`, `step.end`, `content.part`,
`tool.call`, and `tool.result`; the official fold opens an assistant message at
`step.begin`, appends parts, and closes it at `step.end`.
[`loopEventFold.ts` types](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/agent/contextMemory/loopEventFold.ts#L13-L65),
[`loopEventFold.ts` reducer](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/agent/contextMemory/loopEventFold.ts#L136-L203).

Use the `context.append_message` record time for a fully formed message and the
`step.begin` record time for a reconstructed assistant message. This matches
Kimi's transcript reducer, including its `/undo`, compaction, and clear
semantics.
[`contextTranscript.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/agent/contextMemory/contextTranscript.ts#L46-L165)

## Text extraction rules

### User messages

1. For `role: "user"` with no origin (legacy) or `origin.kind: "user"`, join
   text parts in order and replace media parts with typed placeholders. If
   `origin.skillActivations` exists, discard that many leading content parts;
   those are bundled Skill instructions, not words typed by the user.
2. For `origin.kind: "skill_activation"` with `trigger: "user-slash"`, ignore
   the expanded Skill body and synthesize `/<skillName> [skillArgs]`.
3. For `origin.kind: "plugin_command"`, ignore the expanded command body and
   synthesize `/<pluginId>:<commandName> [commandArgs]`.
4. Skip all other user-role origins: `injection`, `shell_command`,
   `compaction_summary`, `system_trigger`, `task`, `cron_job`, `cron_missed`,
   `hook_result`, `retry`, and model/nested Skill activations.

The origin union and Skill trigger distinction are defined in
[`contextMemory/types.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/agent/contextMemory/types.ts#L7-L109).
Kimi itself reconstructs concise Skill/plugin slash commands and strips bundled
Skill parts when deriving user-facing prompt metadata.
[`forkTurnSlice.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/workspace/sessionLifecycle/internal/forkTurnSlice.ts#L185-L214)

### Assistant messages

Import only `text` parts from `role: "assistant"` messages. Join text parts in
order within one assistant step; keep distinct non-empty steps as distinct
messages. Skip `think` parts, `toolCalls`, tool-role messages/results, `note`,
and system-role messages. Preserve a media-only assistant response as its typed
placeholder, but never read or index the URL, data URI, or blob payload.

Kimi's own Markdown exporter maps media to placeholders and identifies
injection/system/compaction/hook/cron origins as internal.
[`export-markdown.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/apps/kimi-code/src/tui/utils/export-markdown.ts#L39-L55),
[`internal origins`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/apps/kimi-code/src/tui/utils/export-markdown.ts#L95-L125).
Large media can be offloaded from the wire into `blobref:` storage, which is
another reason the importer should use placeholders rather than rehydrating
bytes.
[`agentBlobServiceImpl.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/agent/blob/agentBlobServiceImpl.ts#L35-L69)

### Why tool calls are deliberately excluded

Tool events are not conversational text. They contain structured arguments and
raw output, and Kimi's fold turns them into separate assistant `toolCalls` and
tool-role messages.
[`loopEventFold.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/agent/contextMemory/loopEventFold.ts#L166-L195)
Indexing them would add large source dumps, shell output, local paths, and
secrets while duplicating conclusions normally present in the assistant's next
text step. Likewise, `llm.tools_snapshot`, `llm.request`, and
`mcp.tools_discovered` are observability/request-trace records, not messages;
their schemas include tool definitions, request configuration/system prompt,
and raw MCP tool listings.
[`llmRequestOps.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/agent/llmRequester/llmRequestOps.ts#L8-L107),
[`mcpDiscoveryOps.ts`](https://github.com/MoonshotAI/kimi-code/blob/30e7f62d2c2c2fdaef785c544a47d0ade3e9788f/packages/agent-core-v2/src/agent/mcp/mcpDiscoveryOps.ts#L29-L50).

## Compatibility boundary

Legacy Python/uv `kimi-cli` used `~/.kimi/`. Current Kimi Code can migrate
selected old sessions into the new format under `~/.kimi-code` without
modifying the old data. The first RecallBase importer should consume the
post-migration current format only; direct `~/.kimi/` support is a separate
importer/fixture contract.
[Official migration guide](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/migration.html).

Do not depend on launching `kimi web` and scraping its REST API: the official
API is experimental and instructs clients to use the live version-specific
OpenAPI/AsyncAPI documents. Direct local file parsing is faster, offline, and
consistent with RecallBase's local-first boundary.
[Server API stability notice](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html#conventions).

## Required fixture coverage

A stable importer needs sanitized fixtures/tests for:

1. normal direct user + assistant text and epoch-millisecond timestamps;
2. assistant text split across `content.part` events;
3. a pure tool step and a tool result containing unique text that must not be
   searchable/imported;
4. `think` and media parts (thinking absent, media placeholders present, URLs
   absent);
5. bundled Skills plus user-slash Skill/plugin reconstruction without expanded
   instruction bodies;
6. `/undo`, `context.clear`, and compaction (undone turns absent, pre-clear
   history retained, synthetic compaction summary absent);
7. unknown/malformed JSONL records producing diagnostics without aborting other
   sessions;
8. custom `KIMI_CODE_HOME`, missing/bad `state.json`, and a stale/deleted index
   entry; and
9. incremental re-import after appending to an existing `wire.jsonl`, proving
   stable upstream ids and no duplicate messages.
