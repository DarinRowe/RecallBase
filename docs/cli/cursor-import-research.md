# Cursor official interfaces and local history import research

Reviewed on 2026-08-21. Official web documentation was accessed on
2026-08-21. Local findings are anchored to the first-party Cursor Desktop
`3.15.6` build `a1f686545fd0ce8917bbd2449f733551a9bce420` and Cursor Agent CLI
`2026.08.04-aaa8809` installed on the reviewed macOS machine. The review read
only schemas, field names, commands, file names, version metadata, and aggregate
shape information; it did not copy conversation text, tool arguments/results,
credentials, or account data into this document. [L1] [L2] [L3]

## Decision

Implement Cursor as one RecallBase source covering both **Cursor Desktop local
Agent chats** and **Cursor Agent CLI local chats**.

Use two complementary entry paths:

1. **Automatic historical backfill:** read main-agent transcript JSONL files
   below `~/.cursor/projects/*/agent-transcripts/<conversation-id>/` on a
   best-effort, read-only basis. This is an observed first-party persistence
   format, not a published stable file contract. [L3] [L4]
2. **Forward-compatible discovery:** optionally install a user-level Cursor
   `stop` hook that passes the official `conversation_id`, `cursor_version`,
   `workspace_roots`, and `transcript_path` fields to a local RecallBase import
   command. Cursor documents those hook fields and a shared hook system whose
   reference explicitly identifies Desktop/CLI applicability for supported
   events, but it does **not** document the transcript file's content schema or
   promise identical event coverage on both surfaces. Verify `stop` on each
   target surface before enabling it there. [O1]

Import only:

- stable conversation ID;
- workspace/root provenance when available;
- title and timestamps only when a trustworthy metadata source provides them;
- direct user-visible user text; and
- direct user-visible assistant text.

Exclude tool calls and results, thinking, status/error records, subagent
transcripts, terminal output, file contents, diffs, images, system prompts,
hooks, MCP payloads, model request metadata, credentials, and derived search
indexes. The observed JSONL makes user/assistant text separable from tool-use
blocks, while Cursor's official Markdown export likewise treats text/code as
the portable user-facing representation. [L3] [O2]

Do not make production imports depend on invoking Cursor, logging in, calling a
Cursor backend, parsing the interactive `agent ls` UI, driving ACP, or starting
the SDK bridge. Those interfaces can create/resume agents, but none is
documented as a complete machine-readable export of pre-existing Desktop and
CLI history. [O3] [O4] [O5]

## Support and stability matrix

| Surface | What Cursor officially guarantees | Import decision |
| --- | --- | --- |
| Hooks v1 | Command hooks receive JSON on stdin; common fields include stable `conversation_id`, `cursor_version`, `workspace_roots`, and nullable `transcript_path`; `CURSOR_TRANSCRIPT_PATH` is also set when transcripts are enabled | **Use for optional incremental discovery.** Treat the path/identity fields as stable, but probe the file schema independently |
| Desktop chat export | A chat can be exported from the chat view as Markdown containing text and code blocks | **Support later as explicit/manual input** if real sanitized fixtures establish the Markdown conventions; there is no official batch export schema |
| Desktop chat history | Cursor documents that ordinary chat history is local SQLite; background-agent history is remote | Confirms a local-first importer is appropriate, but does not document a database path, tables, or keys |
| `agent ls`, `resume`, `--resume`, `--continue` | Lists/selects or resumes local CLI conversations for an interactive user | Do not parse; no documented JSON history-list or transcript output contract |
| `--print --output-format json\|stream-json` | Emits the current CLI run as JSON or NDJSON, including session ID and current user/assistant/tool events | Useful only to a wrapper launching new work; not a historical enumeration/export API |
| ACP | JSON-RPC 2.0 over NDJSON stdio with `session/new`, `session/load`, `session/prompt`, and streaming updates | Do not use for import; there is no documented session-list or transcript-read method |
| Cursor SDK / SDK Bridge | Versioned APIs for SDK-created local/cloud agents, including list/get/runs/messages; local persistence is workspace-scoped | Do not assume it owns or can enumerate existing Desktop/CLI history; using it would add runtime, API-key, and process-lifecycle costs |
| Cloud Agents API | Public-beta HTTP API to manage cloud agents and runs | Out of scope for this local source; cloud/background conversations are a separate product/data boundary |
| Current local JSONL | First-party Desktop/CLI artifacts contain ordered user/assistant text and tool-use blocks | **Implement for backfill**, behind explicit schema detection and bounded diagnostics |
| Current CLI `store.db` | First-party CLI artifact uses a content-addressed SQLite blob store | Do not decode; every sampled CLI store had a corresponding main JSONL transcript |
| Current `state.vscdb` / `conversation-search.db` | First-party Desktop artifacts contain app state and a derived local conversation search index | Do not use for message bodies; consider the search index only as an optional metadata supplement after fixture-based validation |

Sources for the official rows are the Hooks reference, Desktop history/export
docs, CLI parameter/output docs, ACP docs, SDK docs, and Cloud Agents API. [O1]
[O2] [O3] [O4] [O5] [O6] [O7] Local rows are from the installed first-party
artifacts described under “Local first-party evidence.” [L1] [L2] [L3] [L4]

## Official, supported interfaces

### Hooks v1: strongest supported seam

Cursor supports user hooks at `~/.cursor/hooks.json` with scripts under
`~/.cursor/hooks/`, and project hooks at `<project>/.cursor/hooks.json`.
Command hooks receive JSON on stdin and write JSON to stdout. User hooks apply
globally; project hooks require a trusted workspace and may also run in cloud
agents. [O1]

Every agent hook receives a common input that includes:

```json
{
  "conversation_id": "string",
  "generation_id": "string",
  "model": "string",
  "model_id": "string",
  "model_params": [{ "id": "string", "value": "string" }],
  "hook_event_name": "string",
  "cursor_version": "string",
  "workspace_roots": ["<path>"],
  "user_email": "string | null",
  "transcript_path": "string | null"
}
```

Cursor defines `conversation_id` as stable across turns and
`transcript_path` as the main-conversation transcript path, nullable when
transcripts are disabled. It also exposes the path as
`CURSOR_TRANSCRIPT_PATH`. [O1]

The best RecallBase trigger is `stop`: Cursor defines it as the hook for agent
completion, so it observes a durable boundary after a turn without waiting for
the user to close the chat. `sessionEnd` is fire-and-forget and useful as a
second safety net when the conversation is completed, aborted, errors, the
window closes, or the user closes it. [O1]

A future opt-in integration should merge, not replace, the user's existing
`hooks.json`, and should install a tiny local script that:

1. reads stdin once;
2. extracts only `conversation_id`, `cursor_version`, `workspace_roots`, and
   `transcript_path`;
3. rejects missing, non-file, or out-of-scope transcript paths;
4. invokes an idempotent local import for that single file; and
5. emits no conversation content or path-bearing diagnostics to Cursor's Hook
   output channel.

This design uses Cursor's stable identity/path notification while keeping
RecallBase's parser independent of an undocumented content schema. It also
preserves RecallBase's local-only boundary: no network or Cursor credential is
needed for the hook-triggered import. The no-content logging rule follows
RecallBase's privacy boundary; the available hook fields and user-level
installation location are official. [O1]

Hooks do not solve historical backfill: they fire around new/reopened activity,
and the docs provide no operation that enumerates all prior transcript paths.
Therefore hooks complement rather than replace read-only local discovery.
[O1]

### Desktop Markdown export: supported but manual and lossy

Cursor 0.50 introduced per-chat Markdown export from the chat view. The
official changelog promises text and code blocks in the export. Cursor's history
documentation also advises exporting chats as Markdown to preserve them. [O2]
[O7]

This is a supported portability surface, but it is not sufficient as the main
integration:

- the docs expose no batch/export-directory command or API;
- the docs do not publish a Markdown grammar, conversation ID, workspace,
  timestamp, model, or archive-state fields; and
- exported text/code cannot be assumed to preserve the full event stream.

RecallBase may later accept explicitly selected `.md` files after sanitized
exports from multiple Cursor versions establish how roles and titles are
represented. It should not scan arbitrary Markdown under a workspace and guess
that it is a Cursor export. [O2]

### Cursor Agent CLI commands

The current official CLI surface can list or resume saved conversations:

```text
agent ls
agent resume
agent --resume <chat-id>
agent --continue
```

The locally installed CLI additionally exposes `create-chat`, but the public
history workflow remains list/select/resume. Neither official docs nor the
installed help offer a `--json`/`--export` option for `ls` or `resume`. The
selector is therefore a user interface, not a stable inventory protocol. [O3]
[L2]

Headless print mode is stable for **new/current** runs:

```text
agent --print --output-format json "..."
agent --print --output-format stream-json "..."
```

The documented success JSON contains the final assistant result and
`session_id`; NDJSON emits `system`, `user`, `assistant`, `tool_call`, and
terminal `result` events. Cursor explicitly says fields may be added and
consumers should ignore unknown fields. This is useful precedent for a tolerant
event parser, but it does not enumerate or replay old sessions. [O4]

Running print mode solely to import history would create a new model request,
can expose local files/tools, and requires Cursor authentication. RecallBase
must not do that.

### ACP

`agent acp` is Cursor's official Agent Client Protocol server. It uses JSON-RPC
2.0, one JSON object per line over stdio, and supports `session/new` or
`session/load` followed by `session/prompt`. Cursor positions ACP for custom
agent clients and integrations. [O5]

ACP is not a history importer. The documented method set has no session-list,
message-list, transcript-export, or read-only “load without running” response.
`session/load` resumes a known conversation ID; it is not documented to return
the stored transcript. Driving it would also start a Cursor process and auth
flow for data that already exists locally. [O5]

### Cursor SDK and stable SDK Bridge

The official Python SDK can create/list/get local agents, list runs, and call
`agent.list_messages()`. Its docs state that local agent persistence is
workspace-scoped under a per-workspace state root and that the bridge must be
launched with the same workspace for list/get/resume. [O6]

Cursor also publishes `cursor/sdk-bridge`, a stable `sdk.v1` Connect/protobuf
contract. Its service surface includes `ListAgents`, `GetRunConversation`, and
`ListAgentMessages`; releases are versioned with the SDK. [O8]

These APIs are strong choices for applications that **create and own SDK
agents**, but the docs do not promise that the SDK store enumerates the
pre-existing Desktop or Agent CLI stores. The local SDK IDs are documented as
`agent-<uuid>`, while the observed Desktop/CLI transcript IDs are bare UUIDs.
Depending on the bridge would also introduce a downloaded/native process,
bridge lifecycle, API-key handling for real turns, and workspace-by-workspace
enumeration. [O6] [O8] [L3]

Do not add the SDK dependency for RecallBase history import unless Cursor later
documents Desktop/CLI store interoperability. Even then, direct local reads are
preferable when they remain supported and offline.

### Cloud Agents API is a separate source boundary

Cursor's Cloud Agents API v1 is public beta and lists cloud agents/runs over
`https://api.cursor.com/v1/agents`. It requires an API key and manages remote
agents. Cursor's Desktop history docs separately state that background-agent
chats are stored remotely rather than in ordinary local history. [O7] [O9]

Do not silently combine cloud agents with the local `cursor` source. A future
cloud integration would require explicit login/network consent, pagination,
retention semantics, and a review of whether the API actually exposes complete
message history. It is outside the current local-first goal.

## Local first-party evidence

### Installed product identity

`/Applications/Cursor.app/Contents/Resources/app/package.json` identifies the
app as Cursor `3.15.6` by Anysphere, and `product.json` identifies its data
folder as `.cursor`. The signed app's bundled `bin/cursor --version` reports
`3.15.6`, build `a1f686545fd0ce8917bbd2449f733551a9bce420`, arm64. [L1]

The app-bundled `cursor agent --version` and the separately installed
`~/.local/bin/agent --version` both report `2026.08.04-aaa8809`. Their help
shows `ls`, `resume`, `create-chat`, `--resume`, `--continue`, and the current
print-output options. [L2]

These are point-in-time observations, not minimum-version promises. The
importer should report the detected Cursor version in source health and use it
in fixtures/diagnostics, but should not reject unknown future versions before
trying the schema probe.

### Unified project transcript layout

The installed Cursor products currently materialize main transcripts as:

```text
~/.cursor/projects/
  <project-key>/
    agent-transcripts/
      <conversation-uuid>/
        <conversation-uuid>.jsonl
        subagents/
          <subagent-uuid>.jsonl
```

The directory also contains other unrelated runtime data such as `terminals`,
`agent-tools`, `mcps`, and `canvases`; these are not history sources. [L3]

The first-party SDK type declaration bundled in Cursor says an agent ID is the
conversation UUID and the filename stem from `agent-transcripts/`; the
workbench bundle recognizes those paths as agent transcripts. This is useful
first-party implementation evidence but not an exported compatibility promise.
[L4]

A privacy-safe local comparison found that every sampled CLI
`~/.cursor/chats/<workspace-hash>/<chat-uuid>/store.db` ID also had a main
project transcript with the same UUID. Additional project transcripts existed
without CLI stores, consistent with Desktop and CLI sharing the project
transcript representation while the CLI retains its own run store. [L3]

Therefore implement one transcript adapter and deduplicate by conversation UUID
instead of separate Desktop and CLI message parsers. Treat duplicate UUID files
as replicas/copies: select the valid main transcript with the greatest complete
record count/mtime, and never emit the same conversation twice.

### Observed transcript record shapes

The main JSONL files are line-delimited JSON. Across the local sample, message
records had this top-level shape:

```json
{
  "role": "user | assistant",
  "message": {
    "content": [
      { "type": "text", "text": "..." },
      { "type": "tool_use", "name": "...", "input": { "...": "..." } }
    ]
  }
}
```

Non-message records used `type`, `status`, and sometimes `error`. Main
transcripts contained no top-level created/updated timestamp, workspace path,
title, model, or published schema-version field in the sampled record shapes.
Some conversations also had nested `subagents/*.jsonl`. [L3]

This is an **observed internal schema**. Cursor officially stabilizes only the
hook's transcript path and conversation ID, not these JSON fields. [O1]

The safe parser boundary is:

```text
accept record.role == "user" or "assistant"
accept message.content[] where type == "text" and text is a string
ignore all unknown records, fields, content block types, and roles
```

Preserve array and line order. Join adjacent text blocks within one message
without merging separate records. Skip empty text. Do not stringify unknown
objects into RecallBase because those objects may contain file contents,
commands, local paths, tool results, or model-internal data.

An incomplete final JSONL line can occur while Cursor is writing. Skip only the
trailing malformed line and keep the complete prefix. A malformed interior line
or structurally invalid accepted record should downgrade that conversation's
health and skip the conversation rather than silently reorder it.

### CLI `~/.cursor/chats`: do not decode the blob store

The current Agent CLI computes a workspace bucket as the MD5 of the resolved
working directory and writes chats below
`~/.cursor/chats/<workspace-md5>/<conversation-uuid>/`. The installed bundle's
first-party module names and code expose this location and hash rule. [L2]

Each sampled chat directory contained `meta.json` and `store.db`, sometimes
with SQLite WAL/SHM files and prompt history. `meta.json` exposed metadata keys
including `schemaVersion`, `cwd`, `createdAtMs`, `updatedAtMs`, and
`hasConversation`. The SQLite schema was only:

```sql
CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
```

Blob IDs were content hashes and payloads were opaque serialized data. [L3]

Do not reverse-engineer this store for the first implementation. The mirrored
main transcript is simpler, ordered, already shared with Desktop, and avoids
coupling RecallBase to Cursor SDK runtime serialization. `meta.json` may be
used as an optional exact metadata supplement when its UUID matches the
transcript, but its content schema remains internal and must be separately
validated.

### Desktop SQLite and derived conversation search

Cursor's official history page promises only “stored locally in a SQLite
database”; it does not specify a path or schema. [O7]

On the reviewed macOS installation, Cursor had:

```text
~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
~/Library/Application Support/Cursor/User/globalStorage/conversation-search.db
~/Library/Application Support/Cursor/User/workspaceStorage/*/state.vscdb
```

The installed first-party conversation-search utility explicitly opens global
`state.vscdb` as its source database and `conversation-search.db` as a derived
index. The derived index has local/cloud-cache conversation metadata plus an
FTS table over `title` and `body`; local rows include ID, title, update time,
archive state, and a root fingerprint. [L5]

Do **not** import messages from the search index:

- FTS body text is derived, flattened, and lacks authoritative role/order;
- the database can be rebuilt or pruned by Cursor;
- cloud-cache rows cross the local/cloud boundary; and
- the source and index can be live in WAL mode.

The index can be evaluated later as a title/update/archive supplement for a
matching **local** transcript UUID, but only after tests prove stable behavior
across Cursor versions. Never use `cloud-cache` rows in the local importer.
[L5]

Legacy `state.vscdb` formats have changed across Cursor releases and may mix
workspace metadata, messages, tool data, and application state. No first-party
versioned schema or migration contract was found. Avoid a legacy SQLite parser
in v1; add one only from sanitized fixtures when the missing-history benefit is
measurable.

## Recommended importer design

### Discovery

Default macOS root:

```text
~/.cursor/projects
```

Walk only paths matching:

```text
*/agent-transcripts/<uuid>/<same-uuid>.jsonl
```

Require both directory and filename stems to be the same UUID. Exclude every
path containing `/subagents/`. Do not walk symlinked directories outside the
configured root. Explicit `rb import --root` should accept either the projects
root, one project directory, one `agent-transcripts` directory, or one main
transcript file.

The default root and filename schema are internal observations [L3]; when a
hook supplies an explicit `transcript_path`, prefer that exact path after the
same safety and schema checks [O1]. Cross-platform default paths must be
verified from first-party artifacts on Windows/Linux before claiming automatic
support there.

### Conversation identity and deduplication

Use the UUID filename stem as the source conversation ID. Cursor's bundled SDK
declaration identifies that stem as the agent/conversation ID, and the official
hook independently supplies the stable `conversation_id`. When both exist,
require equality; report a bounded schema diagnostic on mismatch. [O1] [L4]

Use a source-scoped stable ID such as `cursor:<uuid>`. Do not include the
workspace path or project-directory key in the ID because the same conversation
can be materialized under more than one project key. [L3]

If duplicates exist:

1. discard structurally invalid candidates;
2. prefer a candidate whose hook ID/path pair matches;
3. otherwise prefer the greatest number of complete accepted records, then
   newest file mtime; and
4. record only bounded counts/version fingerprints, never duplicate paths or
   transcript text, in diagnostics.

### Metadata precedence

Use this precedence, with every lower layer optional:

1. hook `conversation_id`, `cursor_version`, and `workspace_roots` for triggered
   imports; [O1]
2. matching CLI `meta.json` for CLI-created session `cwd`, created/update time,
   and conversation presence; [L3]
3. matching **local** `conversation-search.db` row for title/update/archive only
   after that adapter is separately validated; [L5]
4. filesystem mtime as `updatedAt` fallback; and
5. a deterministic title from the first direct user text, bounded and redacted
   by the same title rules as other RecallBase importers.

Do not decode the project-directory key back into an absolute path. Its encoding
is not documented, is not reliably reversible when path components contain
hyphens, and can expose private local paths. Treat it only as discovery
structure.

The first implementation can remain simpler: transcript UUID + direct text +
file mtime + derived title. Add metadata adapters only when they improve a
user-visible field and have fixtures. This keeps the message business rule in
one place and prevents Desktop/CLI parsing from drifting.

### Streaming and live-file safety

Process one transcript at a time and one line at a time. Do not load all JSONL
files or all tool payloads into memory. Discard rejected blocks immediately.

Cursor can append while RecallBase imports. Capture the initial file size and
read no bytes past that boundary. Accept a missing final newline and ignore one
incomplete trailing record. A later import will consume the completed record.
This gives a consistent prefix without copying or locking Cursor's live files.

For SQLite metadata, if implemented, open read-only with a short busy timeout
and WAL awareness; failure to read metadata must not discard a valid JSONL
transcript. Never modify, checkpoint, vacuum, migrate, or copy results back into
Cursor databases.

### Schema fingerprint and health

Record a bounded fingerprint made from:

- Cursor version when known;
- top-level record-key sets;
- observed roles; and
- observed `message.content[].type` values.

Do not include values, text lengths, paths, UUIDs, model names, or tool names in
the fingerprint. New unknown fields or block types should produce a degraded
but importable source status when direct text is still valid. No valid
user/assistant text, identity mismatch, malformed interior JSON, or a changed
accepted-field type should mark that conversation unsupported rather than
guessing.

### Import boundary

| Record/block | Import | Reason |
| --- | --- | --- |
| `role=user`, `content[].type=text` | Yes | Direct user-visible prompt text |
| `role=assistant`, `content[].type=text` | Yes | Direct user-visible assistant text |
| `tool_use` and its `input` | No | Commands, paths, prompts, file contents, or nested agent requests may be present |
| Status/error records | No | Runtime control/diagnostic data, not conversation turns |
| `subagents/*.jsonl` | No | Internal/nested execution; can duplicate parent-visible summaries and greatly increase noise |
| CLI `prompt_history.json` | No | Draft/history UI data and potential duplicates |
| CLI `store.db` blobs | No | Opaque internal serialization; transcript mirror exists |
| Desktop `cursorDiskKV` / app state | No in v1 | Undocumented legacy/internal state with high drift and privacy risk |
| `conversation-search.db` FTS body | No | Derived flattened index, not authoritative ordered messages |
| Cloud-cache/background-agent data | No | Remote product boundary and different consent/auth model |
| Markdown export | Explicit/manual later | Official portable representation, but undocumented grammar and no batch metadata |

This boundary mirrors RecallBase's existing principle: index useful
user-visible conversation text, not execution traces or raw evidence payloads.

## Compatibility and privacy risks

### Internal schema drift

Cursor labels the Agent CLI beta, the Cloud API public beta, and only the SDK
Bridge contract as explicitly versioned/stable. The local transcript schema is
not documented. Unknown-field tolerance, fixtures by Cursor version, and
conversation-local failure are mandatory. [O3] [O8] [O9]

### Partial and duplicate history

Hooks can have a null transcript path, historical sessions may use legacy
SQLite only, active files can end with partial JSON, and one UUID can appear
under multiple project keys. Source status should report imported/skipped/
unsupported counts without listing paths or IDs. [O1] [L3]

### Sensitive content

Tool inputs and app databases can contain source code, commands, absolute local
paths, environment-derived data, terminal output, MCP payloads, and nested
prompts. Rejecting all non-text blocks before retention is safer than trying to
redact arbitrary tool schemas. [L3]

### Remote/cloud separation

Cursor distinguishes ordinary local history from remote background/cloud
agents. RecallBase must not query Cursor APIs, read cloud-cache rows, or imply
that a local import is a cloud backup. [O7] [O9]

### User hooks are mutable user configuration

Installing a hook changes `~/.cursor/hooks.json`, which may already contain
security or automation rules. Make hook installation explicit, idempotent,
merge-aware, reversible, and independently testable. Uninstall only the exact
RecallBase entry/script and leave all other user configuration untouched. [O1]

### Data use policy is not a history API

Cursor's Privacy Mode/data-use promises govern how Cursor and model providers
handle requests; they do not define a local transcript schema or grant a batch
history API. RecallBase should stay offline and avoid requiring credentials for
local import. [O10]

## Implementation and validation plan

### Phase 1: current local Desktop + CLI

1. Add one `cursor` importer with default root `~/.cursor/projects`.
2. Discover only main UUID JSONL files and deduplicate by UUID.
3. Stream user/assistant text; reject every other block/record.
4. Use mtime and first user text for minimal metadata.
5. Add bounded schema diagnostics and source-version fingerprinting.
6. Add `--root` support for fixtures/custom locations.
7. Document that current automatic support is validated on macOS Cursor
   Desktop `3.15.6` / Agent CLI `2026.08.04-aaa8809`, with tolerant future
   probing rather than a claimed version guarantee. [L1] [L2] [L3]

### Phase 2: optional official Hook bridge

1. Provide explicit install/verify/uninstall commands for a user-level `stop`
   hook.
2. Merge the v1 hook configuration without changing other entries.
3. Trigger a single-file idempotent import from the official transcript path.
4. Add `sessionEnd` only if missed-stop testing demonstrates value.
5. Verify `stop` behavior independently in Desktop and `cursor agent`; the
   official hook reference describes shared Desktop/CLI applicability, but does
   not provide an explicit per-event compatibility matrix. [O1]

### Phase 3: evidence-driven metadata and legacy coverage

1. Collect sanitized fixtures from multiple Cursor versions and operating
   systems.
2. Evaluate CLI `meta.json` as a metadata-only adapter.
3. Evaluate local-only `conversation-search.db` metadata without FTS bodies.
4. Measure how many user sessions remain SQLite-only before building a legacy
   `state.vscdb` parser.
5. Add manual Markdown export only after role/title grammar fixtures exist.

Do not build speculative adapters for old schemas solely from forum posts or
unversioned key names.

### Required fixtures

- minimal user + assistant transcript;
- multiple text blocks in one message;
- interleaved tool-use blocks that must be excluded;
- status/error-only file;
- incomplete trailing JSON line;
- malformed interior line;
- unknown future top-level field and content type;
- duplicate UUID under two project keys;
- main plus subagent transcripts;
- hook identity/path match and mismatch;
- matching/missing/malformed CLI `meta.json`;
- live append bounded by initial file size;
- non-UTF-8 or oversized line with bounded failure;
- symlink escape attempt; and
- transcript with no useful direct text.

### Differential/manual validation

For a sanitized test conversation created in Desktop and CLI:

1. export the Desktop chat as Markdown;
2. capture the CLI current run with documented `stream-json`;
3. compare only user/assistant visible text with the local importer;
4. confirm no tool input/result, path, command, thinking, or status content
   enters RecallBase; and
5. re-import while Cursor is open to verify idempotence and incomplete-tail
   handling. [O2] [O4]

Markdown and current-run NDJSON are test oracles for visible text, not
production history dependencies.

## Sources

### Official web sources

- **[O1] Cursor Hooks:** user/project locations, command-hook JSON protocol,
  common identity/version/workspace/transcript fields, `stop`, `sessionEnd`,
  environment variables, and Desktop/CLI applicability.
  [Cursor Hooks reference](https://prod.cursor.com/docs/hooks)
  (accessed 2026-08-21).
- **[O2] Desktop Markdown export:** Cursor 0.50 added chat-view Markdown export
  containing text and code blocks.
  [Cursor 0.50 changelog](https://cursor.com/changelog/page/14#0-50)
  (accessed 2026-08-21).
- **[O3] Cursor Agent CLI:** beta status, session list/resume commands, and
  print mode.
  [CLI overview](https://prod.cursor.com/docs/cli/overview) and
  [CLI usage](https://prod.cursor.com/docs/cli/using)
  (accessed 2026-08-21).
- **[O4] CLI output formats:** current-run JSON/NDJSON schemas and
  forward-compatible unknown-field guidance.
  [CLI output format](https://prod.cursor.com/docs/cli/reference/output-format)
  (accessed 2026-08-21).
- **[O5] ACP:** JSON-RPC/NDJSON stdio protocol and documented session flow.
  [Cursor ACP](https://prod.cursor.com/docs/cli/acp)
  (accessed 2026-08-21).
- **[O6] Cursor SDK:** local agent/message APIs and workspace-scoped local
  persistence.
  [Cursor Python SDK](https://prod.cursor.com/docs/sdk/python)
  (accessed 2026-08-21).
- **[O7] Desktop history:** ordinary history is local SQLite; background-agent
  chats are remote; Markdown export is the preservation path.
  [Cursor history](https://docs.cursor.com/en/agent/chat/history)
  (accessed 2026-08-21).
- **[O8] SDK Bridge:** stable `sdk.v1` protocol, releases, service surface, and
  versioning promise.
  [Official `cursor/sdk-bridge` repository](https://github.com/cursor/sdk-bridge)
  (accessed 2026-08-21).
- **[O9] Cloud Agents API:** public-beta remote agent/run API and authentication
  boundary.
  [Cloud Agents API v1](https://prod.cursor.com/docs/cloud-agent/api/endpoints)
  (accessed 2026-08-21).
- **[O10] Data handling:** current Cursor Privacy Mode and request-retention
  statements.
  [Cursor Data Use & Privacy Overview](https://cursor.com/data-use)
  (accessed 2026-08-21).

### Local first-party artifact sources

- **[L1] Desktop identity and product metadata:**
  `/Applications/Cursor.app/Contents/Resources/app/package.json`,
  `/Applications/Cursor.app/Contents/Resources/app/product.json`, and
  `/Applications/Cursor.app/Contents/Resources/app/bin/cursor --version`.
- **[L2] Agent CLI identity/help and first-party state implementation:**
  `/Applications/Cursor.app/Contents/Resources/app/bin/cursor agent --help`,
  `~/.local/bin/agent --help`, and installed bundle
  `~/.local/share/cursor-agent/versions/2026.08.04-aaa8809/`, especially the
  bundled `./src/state/index.ts` module in `1623.index.js`.
- **[L3] Privacy-safe shape scan of current local artifacts:** file discovery
  below `~/.cursor/projects/*/agent-transcripts/` and `~/.cursor/chats/`;
  `jq` was used only to enumerate JSON key paths/types/roles/block types, and
  `sqlite3` only for table DDL, key names, and aggregate counts. No message text
  or tool value was included in the research output.
- **[L4] Bundled first-party Desktop implementation evidence:**
  `/Applications/Cursor.app/Contents/Resources/app/extensions/cursor-agent-exec/dist/agent-sdk/cursor/canvas/hooks.d.ts`
  documents that an agent ID is the conversation UUID/filename stem in
  `agent-transcripts/`; the installed workbench bundle recognizes that path as
  an agent transcript.
- **[L5] Bundled first-party conversation-search implementation and local DDL:**
  `/Applications/Cursor.app/Contents/Resources/app/out/vs/code/electron-utility/conversationSearch/conversationSearchMain.js`
  and read-only SQLite schema inspection of
  `~/Library/Application Support/Cursor/User/globalStorage/conversation-search.db`.

Local artifact paths are evidence for the reviewed installation only. They are
not public API promises and must never be presented to users as Cursor-supported
storage contracts.
