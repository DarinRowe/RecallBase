# Grok official interfaces and local history import research

Reviewed on 2026-08-20. API/product pages were accessed on 2026-08-20;
Grok Build source claims were reviewed against the official `xai-org/grok-build`
commit [`19d42e3`](https://github.com/xai-org/grok-build/commit/19d42e35c07a9c9244f03f6df0c4c353f970d4f9)
from 2026-08-19 (accessed 2026-08-20). Only first-party xAI/SpaceXAI and X
sources are used.

## Decision

Build the first RecallBase integration as a **Grok Build local-session
importer**, not as an xAI inference-API client and not as a Grok.com scraper.
Discover sessions under `$GROK_HOME/sessions` (default `~/.grok/sessions`),
read `summary.json` for metadata, and stream `updates.jsonl` for the transcript.
The official session guide says every TUI, headless, and ACP conversation is
saved locally and explicitly identifies `updates.jsonl` as the authoritative
conversation log. [Official Grok Build session guide](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md#L1-L39)
(accessed 2026-08-20).

Import one RecallBase conversation per user-visible Grok Build session. Import
only:

- session ID, preferred title, working directory, created/updated timestamps,
  model ID, parent session ID, and minimal session-kind provenance;
- direct, user-visible text prompts; and
- user-visible assistant text.

Do **not** import tool calls/results, thinking, host-generated turns, shell-mode
commands, plans, tasks, feedback, rewind snapshots, trace data, raw model chat
history, credentials, git remotes, request IDs, or file/media payloads. This
matches the useful transcript boundary in Grok Build's own Markdown exporter,
which emits user text and assistant text, deliberately skips thinking and
system chrome, and renders tools separately. RecallBase should take the safer
subset by omitting tools too. [Official Markdown exporter](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-pager/src/scrollback/export.rs#L1-L68)
(accessed 2026-08-20).

The next integration, after obtaining a sanitized real export, can be a
**manual Grok.com/mobile data-export importer**. xAI officially provides a
download control in Grok.com/mobile under Settings > Data Controls, but it does
not publish the archive filenames or JSON schema. Do not guess that schema.
[xAI Consumer FAQ](https://x.ai/legal/faq#how-do-i-submit-a-data-subject-rights-request)
(accessed 2026-08-20).

## Supported-surface matrix

| Surface | Official history capability | RecallBase decision |
| --- | --- | --- |
| Grok Build CLI | Full local sessions in `$GROK_HOME/sessions`; `updates.jsonl` is authoritative | **Implement first**: local, offline, complete, documented, and testable |
| `grok export <session-id>` | Exports one local session as Markdown | Use as a differential test oracle; do not depend on the binary in production because Markdown loses timestamps/metadata and includes tool summaries |
| Grok.com / Grok mobile | User can download account data from Data Controls | **Defer parser** until a sanitized official export fixture establishes the schema |
| Grok on X | X stores/deletes Grok interactions; X offers a general HTML/JSON account archive | **Defer**: official X archive docs do not say that Grok conversations are included or document their format |
| xAI Responses API | Create, chain, retrieve, and delete a response by known ID; default 30-day storage | Not a history-import source: there is no documented response-list endpoint |
| xAI Chat Completions API | Stateless inference endpoint | Not a history-import source: callers own the history |
| Grok Build remote sync/share | CLI can combine local and remote search and sync/share via xAI services | Do not call undocumented/private session endpoints; locally materialized sessions are already covered |
| Grok share links | User can publish/revoke individual public links | Not enumerable and privacy-sensitive; do not scrape as an importer |

The Grok Build CLI reference documents both `grok export <session-id> [output]`
and the `grok sessions` commands. [Official CLI reference](https://docs.x.ai/build/cli/reference)
(accessed 2026-08-20). The session guide says `grok sessions search` combines a
local SQLite index with remote results, so CLI list/search output is not a
clean, complete local-source contract. [Official session CLI section](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md#L249-L265)
(accessed 2026-08-20).

## xAI inference API: what it supports and why it is not history sync

### Endpoint, authentication, and SDK compatibility

The REST base is `https://api.x.ai`; versioned inference routes use `/v1`, and
every request uses `Authorization: Bearer <XAI_API_KEY>`. xAI describes the
inference API as OpenAI REST compatible. [Inference REST overview](https://docs.x.ai/developers/rest-api-reference/inference)
(accessed 2026-08-20). Compatibility is endpoint/field specific rather than a
promise of identical behavior: the formal reference marks some accepted fields
as ignored or compatibility-only, so clients should tolerate xAI-specific
responses and errors. [Official Chat API reference](https://docs.x.ai/developers/rest-api-reference/inference/chat)
(accessed 2026-08-20). The normal OpenAI-client configuration is therefore:

```text
base URL: https://api.x.ai/v1
header:   Authorization: Bearer $XAI_API_KEY
```

This API key belongs to an xAI API team. It is not a supported way to read a
consumer's Grok.com or X account history, and RecallBase must never look for or
read Grok Build's `auth.json` to obtain credentials.

xAI maintains the Python `xai-sdk`, which uses xAI's public gRPC protocol; xAI
also publishes the protobuf definitions. The official JavaScript examples use
the OpenAI SDK or Vercel AI SDK. No xAI-maintained first-party Node/TypeScript
SDK was found in the reviewed official organization, so a future TypeScript API
feature should prefer the already-compatible OpenAI client instead of adding a
new provider abstraction. [Official xAI Python SDK](https://github.com/xai-org/xai-sdk-python)
and [official protobuf definitions](https://github.com/xai-org/xai-proto)
(both accessed 2026-08-20).

### Text interfaces and formats

The Responses API (`POST /v1/responses`) is xAI's preferred interface. It uses
typed `input` items and returns typed `output` items, supports server-side
tools, structured output, multimodal input, SSE streaming, and stateful chaining
with `previous_response_id`. Chat Completions (`POST /v1/chat/completions`) is
the legacy/deprecated, stateless interface and returns OpenAI-style
`choices[].message`. [Official Responses vs Chat Completions comparison](https://docs.x.ai/developers/model-capabilities/text/comparison)
(accessed 2026-08-20). Streaming uses Server-Sent Events when `stream: true`.
[Official streaming guide](https://docs.x.ai/developers/model-capabilities/text/streaming)
(accessed 2026-08-20).

The authenticated model catalogs are `GET /v1/models` for a compact list and
`GET /v1/language-models` for modalities, fingerprints, aliases, and pricing.
The documented responses are whole arrays, with no cursor or page parameters.
Do not hard-code current Grok model names, aliases, prices, or context sizes;
query the catalog if an inference feature ever needs them. [Official model API reference](https://docs.x.ai/developers/rest-api-reference/inference/models)
(accessed 2026-08-20).

Both Chat Completions and Responses support client-side function calling and
server-side tools. Structured outputs accept JSON Schema, and image-understanding
inputs can use public URLs or base64 data URLs. These features affect an
inference client but do not expose saved consumer conversations. [Official function-calling guide](https://docs.x.ai/developers/tools/function-calling),
[structured-output guide](https://docs.x.ai/developers/model-capabilities/text/structured-outputs),
and [image-understanding guide](https://docs.x.ai/developers/model-capabilities/images/understanding)
(all accessed 2026-08-20).

The separate Files API can upload and list API-owned files. `GET /v1/files`
uses `limit`, `order`, `sort_by`, `pagination_token`, and optional AIP-160
filters; its OpenAI-compatible `after` field is not the native cursor. This is
the only reviewed relevant API with a documented cursor-like pagination
contract, and it enumerates files, not conversations. [Official Files management reference](https://docs.x.ai/developers/rest-api-reference/files/manage)
(accessed 2026-08-20).

### Stored responses, enumeration, and pagination

Responses are stored by default for 30 days. `store: false` disables response
storage for that request. A stored response can be retrieved or deleted only
with a known ID at `GET/DELETE /v1/responses/{response_id}`. [Official text-generation guide: retention](https://docs.x.ai/developers/model-capabilities/text/generate-text#chaining-the-conversation),
[disable storage](https://docs.x.ai/developers/model-capabilities/text/generate-text#disable-storing-previous-requestresponse-on-server),
and [retrieve/delete](https://docs.x.ai/developers/model-capabilities/text/generate-text#retrieving-a-previous-model-response)
(all accessed 2026-08-20).

The complete official Chat/Responses REST reference lists create, retrieve by
ID, delete by ID, and deferred-completion retrieval, but no operation to list
or page through responses. Therefore the following is an explicit inference
from the published API surface: **an API key alone cannot enumerate a user's
historical API conversations**, and there is no pagination contract RecallBase
could implement. [Official Chat/Responses API reference](https://docs.x.ai/developers/rest-api-reference/inference/chat)
(accessed 2026-08-20).

### Rate limits, errors, and privacy

Limits are per API team and model on both requests per second (RPS) and tokens
per minute (TPM); they vary by spend tier. Exceeding either returns HTTP 429,
and xAI recommends exponential backoff. Do not encode today's numbers because
models and tiers change. [Official rate-limit guide](https://docs.x.ai/developers/rate-limits)
(accessed 2026-08-20). The documented common errors are 400, 401, 403, 404,
405, 415, 422, and 429. [Official debugging guide](https://docs.x.ai/developers/debugging)
(accessed 2026-08-20).

xAI says API inputs/outputs are not used for training without explicit
permission. By default API requests and responses are encrypted at rest and
retained for 30 days for abuse auditing; team-wide Zero Data Retention disables
storage-dependent features, including stateful Responses, Files, Collections,
and Batch. [Official API security FAQ](https://docs.x.ai/developers/faq/security)
(accessed 2026-08-20). These rules reinforce that the API is an inference
transport, not a durable history database.

## Grok Build local storage and discovery

### Root and layout

The official layout is:

```text
$GROK_HOME/                                  # default ~/.grok
└── sessions/
    └── <encoded-cwd>/
        ├── .cwd                             # only for long, hashed cwd buckets
        └── <session-id>/
            ├── summary.json                 # session index/metadata
            ├── updates.jsonl                # authoritative transcript stream
            ├── chat_history.jsonl           # derived/raw model-request history; skip
            ├── plan.json                    # skip
            ├── rewind_points.jsonl          # skip
            ├── signals.json                 # skip
            ├── feedback.jsonl               # skip
            ├── compaction_checkpoints/       # model-state checkpoints; skip
            └── subagents/                    # metadata only; child sessions live above
```

`GROK_HOME` overrides the base directory verbatim when non-empty; otherwise
Grok uses the user's `~/.grok`. [Official Grok-home implementation](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-home/src/lib.rs#L1-L59)
(accessed 2026-08-20). Grok creates session directories owner-only on Unix.
For short working directories, the bucket is URL encoded. If that result
exceeds 255 bytes, Grok uses `<slug>-<16 hex BLAKE3>` and writes the original
working directory to `.cwd`. [Official cwd-path implementation](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-config/src/paths.rs#L59-L189)
(accessed 2026-08-20).

Discovery should walk `sessions/*/*/updates.jsonl` and derive each session
directory from the match. Do not reimplement URL encoding or BLAKE3 merely to
find sessions; walking is simpler and also handles legacy/relocated buckets.
Read the working directory from `summary.json.info.cwd`, then `.cwd`, then a
decoded bucket name only as fallbacks. Include an adjacent `summary.json` in the
discovered path set when present so schema fingerprints and incremental-change
detection see metadata changes.

### Why `updates.jsonl`, not `chat_history.jsonl` or `grok export`

Grok's official source calls `updates.jsonl` the source of truth and says
`chat_history.jsonl` is only for LLM API calls. [Official session-export source](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/session/export.rs#L1-L8)
(accessed 2026-08-20). The raw chat file can contain system context, reasoning,
tool arguments/results, source files, and duplicated content, so it is both less
correct and less private for RecallBase.

`grok export <session-id>` is useful for tests because it replays the official
update stream and renders Markdown. It is not the production import path: it
requires an installed binary, materializes the whole replay, emits no message
timestamps or structured metadata, and includes a Tools section. [Official CLI export implementation](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-pager/src/export_cmd.rs#L11-L85)
(accessed 2026-08-20).

## `summary.json` contract

The fields RecallBase needs are:

| Field | Shape | RecallBase use |
| --- | --- | --- |
| `info.id` | string session ID, normally UUIDv7 | `upstreamId`; directory name fallback |
| `info.cwd` | string | workspace metadata; `.cwd`/bucket fallback |
| `generated_title` | optional string | preferred title when non-empty |
| `session_summary` | string | title fallback |
| `created_at`, `updated_at` | RFC 3339 strings in current files | conversation timestamps |
| `last_active_at` | optional RFC 3339 string | optional recency fallback only |
| `current_model_id` | string-like ACP model ID | conversation/message model metadata |
| `parent_session_id` | optional string | fork/restore provenance |
| `session_kind` | optional string | visibility/provenance |
| `hidden` | optional boolean | visibility override |
| `title_is_manual` | boolean | provenance only; title priority is unchanged |

The authoritative `Summary` type also contains git remotes, commits, request
IDs, Grok-home paths, trace state, sandbox settings, worktree paths, recaps,
and other operational data. Do not copy those wholesale. [Official `Summary` schema](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/session/persistence.rs#L817-L951)
(accessed 2026-08-20).

Title priority must match Grok: non-empty trimmed `generated_title`, then
`session_summary`, then RecallBase's usual first-user-text/session-ID fallback.
[Official `display_title`](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/session/persistence.rs#L1022-L1035)
(accessed 2026-08-20).

Skip a session when `hidden === true`; when `hidden` is absent, skip if
`session_kind` begins with `subagent`. This mirrors Grok's own listing rule and
avoids indexing internal child work twice. Explicit `hidden: false` overrides
the default and makes a subagent session importable. [Official visibility rule](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/session/persistence.rs#L1013-L1020)
(accessed 2026-08-20).

## `updates.jsonl` wire contract

### Envelope and compatibility

Current lines are independent JSON objects:

```json
{
  "timestamp": 1750000000,
  "method": "session/update",
  "params": {
    "sessionId": "<session-id>",
    "update": {
      "sessionUpdate": "user_message_chunk",
      "content": { "type": "text", "text": "hello" },
      "_meta": { "promptIndex": 0 }
    }
  }
}
```

`timestamp` is Unix seconds written with the record. `method` is normally
`session/update` for ACP content or `_x.ai/session/update` for xAI control
events. Official parsing also accepts a legacy line whose top level is the ACP
notification without the envelope; RecallBase should do the same. Unknown or
malformed lines should end any open text segment, emit a diagnostic, and not
abort other sessions. [Official envelope implementation](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/session/storage/mod.rs#L539-L677)
(accessed 2026-08-20).

Use the first contributing chunk's envelope timestamp for a reconstructed
message. Fall back to `summary.created_at`. If a future/legacy line contains no
stable event timestamp, deterministic ordering matters more than inventing a
wall-clock time.

### Transcript reducer

Apply rewind filtering to the raw event timeline first, then reduce surviving
events into messages:

| Event | Import behavior |
| --- | --- |
| ACP `user_message_chunk` with `content.type: "text"` | append text to the current real user run |
| ACP `agent_message_chunk` with text content | append to the current assistant segment |
| ACP `agent_thought_chunk` | skip without splitting a surrounding assistant segment |
| ACP `tool_call`, `tool_call_update` | skip content and close the current assistant segment; later assistant text starts a new message |
| xAI `rewind_marker` | remove the dead branch according to `target_prompt_index`, then continue with later events |
| xAI `compaction_checkpoint` | skip; keep visible ACP text on both sides for historical search |
| commands catalog, plans, tasks, modes, status, feedback, subagent lifecycle, everything else | skip; conservatively close an open segment unless it is known intra-message metadata |

This behavior follows the same tags and text boundaries used by Grok's own
single-pass search collector: it reads user/assistant text, keeps assistant
chunks joined across thought chunks, flushes at tools/turn boundaries, and does
not index thoughts. [Official local search collector](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/session/storage/search_content.rs#L1-L239)
(accessed 2026-08-20). RecallBase intentionally differs only by omitting tool
titles/paths, because tool data adds sensitive, duplicate noise.

For user runs, copy Grok's progressive `promptIndex` rule:

1. Before any `_meta.promptIndex` has appeared, consecutive legacy user chunks
   form/count normal user runs.
2. Once a numbered chunk has appeared, only numbered runs count. Unnumbered
   runs are mid-turn phantom/host content and must be dropped.
3. A changed `promptIndex` starts a new user run even when chunks are adjacent.
4. Exclude `content._meta.bash_command` and update `_meta.hostTurn: true`.

These are Grok's own prompt-extraction rules. [Official selective prompt parser](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/session/storage/mod.rs#L1536-L1737)
and [metadata filters](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/session/storage/mod.rs#L1920-L2044)
(both accessed 2026-08-20).

Only `content.type: "text"` is searchable. For image/audio/resource content,
never retain URLs, data URIs, file bytes, or attachment bodies. A compact typed
placeholder such as `[image]` is acceptable only when it is useful to preserve
a media-only turn; otherwise skip the non-text chunk. This is stricter than the
official ACP persistence format by design and preserves RecallBase's privacy
boundary.

### Rewind and compaction

`rewind_marker.target_prompt_index` means restore to **before** that prompt.
The canonical Grok filter records the start of each counted user run, truncates
all surviving events back to the target start when a marker arrives, drops the
marker, and then accepts later replacement events. Apply this filter to the
whole event list (or a logically equivalent streaming reducer) so both user and
assistant text from abandoned branches disappear. [Official rewind filter](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/session/storage/mod.rs#L1363-L1475)
(accessed 2026-08-20).

Compaction changes model context, not the historical RecallBase transcript.
Grok's normal replay/export path rewind-filters the stream, forwards ACP
updates, and ignores xAI-only events such as compaction checkpoints. Therefore
the importer should retain original visible text before compaction and skip
synthetic summaries/checkpoint files. [Official replay path](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/session/storage/replay.rs#L161-L203)
and [ACP-only replay loop](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-shell/src/session/storage/replay.rs#L370-L394)
(both accessed 2026-08-20).

### Stable identities and incremental imports

Use `summary.info.id` as the conversation upstream ID. For messages, prefer a
persisted event ID when present; otherwise derive a stable ID from session ID,
role, first source-line number, and segment ordinal. Append-only line positions
are stable for ordinary growth, while a rewind naturally retires old IDs and
introduces replacement-line IDs. Do not hash only text: repeated prompts and
answers are valid distinct messages.

Read JSONL as a stream. Memory should scale with surviving user/assistant text,
not with tool output or the full session file. Grok's format is explicitly
append-oriented and intended for efficient streaming. [Official persistence-format section](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md#L325-L350)
(accessed 2026-08-20).

## Consumer Grok.com/mobile and Grok on X

### Grok.com/mobile export

xAI's consumer FAQ states that registered users may keep account history, that
Private Chat is not viewable in history and is removed from xAI systems within
30 days, and that users can access/download/delete data from Grok.com or the
mobile app under Settings > Data Controls. [xAI Consumer FAQ](https://x.ai/legal/faq)
(accessed 2026-08-20).

No reviewed official page specifies the downloaded archive's filename tree,
conversation schema, timestamp units, pagination, attachment representation,
or incremental-export semantics. Consequently:

- do not scrape authenticated Grok.com endpoints, browser storage, cookies, or
  undocumented network payloads;
- do not claim compatibility based on a third-party sample;
- request a sanitized user export and freeze its schema as a fixture before
  implementing this importer; and
- treat manual exports as snapshots, deduplicated by stable conversation and
  message IDs when the archive supplies them.

Public share links are also unsuitable for history discovery. xAI says a user
must create them per conversation, anyone with the link can access them, and
the user can revoke them. [xAI Consumer FAQ: sharing](https://x.ai/legal/faq#can-i-share-my-grok-conversations)
(accessed 2026-08-20).

### Grok on X

X, not the standalone xAI consumer policy, governs Grok used inside X. X says
it stores Grok interactions/inputs/results and offers a control to delete all
Grok conversation history; deletion completes within 30 days except for
security/legal retention. [X Help: About Grok](https://help.x.com/en/using-x/about-grok)
(accessed 2026-08-20).

X separately offers a machine-readable account archive with HTML and JSON, but
the official archive page enumerates posts, DMs, media, follows, contacts,
lists, ads, and other account data without promising Grok conversations or a
Grok schema. [X Help: access and download X data](https://help.x.com/en/managing-your-account/accessing-your-x-data)
(accessed 2026-08-20). Therefore support for an X archive must wait for a
sanitized current archive proving that Grok history is present. Do not assume
the standalone Grok.com export and X archive share a format.

### Local consumer clients

The official consumer surfaces reviewed are Grok.com, iOS, Android, and Grok on
X. None documents a supported on-disk conversation database or local export
path. Mobile app sandboxes and browser caches are not stable public interfaces.
Only Grok Build documents a local session contract, so it is the only local
client importer justified by official evidence today. [xAI Consumer FAQ product links](https://x.ai/legal/faq)
(accessed 2026-08-20).

## RecallBase implementation shape

Add a `grok-build` importer next to the existing local coding-agent importers.
Reuse the current common modules for discovery, JSON narrowing, schema
fingerprints, title fallbacks, diagnostics, import batching, and source
registry. Do not create a generic “xAI provider” abstraction: Grok Build local
ACP events, consumer export snapshots, and Responses API objects have different
lifecycles and schemas.

The one worthwhile shared extraction is a streaming JSONL reader if both Kimi
Code and Grok Build otherwise duplicate the same line-reading, object
validation, trailing-partial-line, and malformed-record diagnostics. Keep
source-specific event reducers separate. That is the DRY boundary where one
business rule could drift; sharing Grok-specific tag logic with unrelated
importers would be premature.

Suggested source contract:

```text
source ID:    grok-build
source label: Grok Build
default root: $GROK_HOME/sessions or ~/.grok/sessions
authority:    updates.jsonl + optional summary.json
confidence:   stable for the pinned official format, guarded by fixtures and schema fingerprint
```

Do not add an API key setting, network request, login flow, or xAI SDK
dependency for this importer. A direct local parser is faster, offline, more
private, and smaller.

## Required fixture and verification coverage

A production-ready importer needs sanitized fixtures/tests for:

1. normal `summary.json`, one user message, and one assistant message;
2. multi-chunk user/assistant text with Unix-second event timestamps and RFC
   3339 summary timestamps;
3. title priority (`generated_title` over `session_summary`) and custom
   `GROK_HOME` discovery;
4. legacy raw notification lines without the current envelope;
5. thought chunks between assistant chunks (thinking absent, visible text kept
   together);
6. tools, tool results, shell-mode commands, `hostTurn`, plans, feedback, and
   unique sensitive/path text that must not become searchable;
7. media content proving payload/URL bytes are absent and any chosen placeholder
   is compact;
8. progressive `promptIndex` behavior, including legacy prompts and unnumbered
   phantom runs after the first numbered prompt;
9. rewind with an abandoned user/assistant branch and later replacement text;
10. compaction checkpoints with visible text on both sides and no synthetic
    checkpoint/summary text;
11. hidden/default-hidden subagent sessions, explicit `hidden: false`, and a
    visible fork with `parent_session_id`;
12. long-cwd `.cwd` fallback, missing/bad `summary.json`, malformed middle
    JSONL, and an incomplete trailing line;
13. incremental append/re-import, proving stable conversation/message IDs and
    no duplicates; and
14. a large tool-heavy JSONL proving memory remains bounded by useful text.

Use the installed official CLI as a non-network differential oracle: point a
temporary `GROK_HOME` at sanitized fixtures, run `grok export <session-id>`,
strip its Tools sections, and compare User/Assistant order and text with the
RecallBase reducer. The CLI export command itself reads the authoritative update
stream and applies Grok's replay logic. [Official export implementation](https://github.com/xai-org/grok-build/blob/19d42e35c07a9c9244f03f6df0c4c353f970d4f9/crates/codegen/xai-grok-pager/src/export_cmd.rs#L22-L43)
(accessed 2026-08-20).

The official install commands are:

```sh
curl -fsSL https://x.ai/cli/install.sh | bash   # macOS/Linux/Git Bash
irm https://x.ai/cli/install.ps1 | iex          # Windows PowerShell
grok --version
```

[Official Grok Build repository README](https://github.com/xai-org/grok-build/tree/19d42e35c07a9c9244f03f6df0c4c353f970d4f9#installing-the-released-binary)
(accessed 2026-08-20). On this development machine, read-only verification found
`/Users/darinlo/.local/bin/grok` reporting `grok 1.0.5 (5115b46bc909)` on
2026-08-20. No local Grok conversation contents or credentials were inspected.

## Open questions that require an official fixture or future contract

- What exact files and schema are emitted by the current Grok.com/mobile data
  download?
- Does the current X account archive include Grok conversations, and under what
  filename/schema?
- Will xAI publish a consumer-history API or a list/pagination operation for
  stored Responses?
- Will Grok Build add an explicit session wire-schema version? Current
  compatibility relies on tolerant parsing plus schema fingerprints.

None of these questions blocks the Grok Build local importer.
