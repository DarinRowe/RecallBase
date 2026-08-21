# Pi official interfaces and local history import research

Reviewed on 2026-08-21. The released-format findings are anchored to Pi
`v0.81.1`, commit
[`20be4b1`](https://github.com/earendil-works/pi/commit/20be4b18d4c57487f8993d2762bace129f0cf7c6),
because that is the version installed on the reviewed machine. The latest
published GitHub release found during the review was
[`v0.83.0`](https://github.com/earendil-works/pi/releases/tag/v0.83.0). Forward-
compatibility findings are additionally anchored to official `main` commit
[`5cd93f6`](https://github.com/earendil-works/pi/commit/5cd93f688aaab89dbb6dfa4aca535f21796ae185)
from 2026-08-20. Only Pi's own repository, release/package artifacts, and the
locally installed official package were used.

## Decision

Build the first RecallBase integration as a **read-only Pi v1-v3 local JSONL
session importer**. Discover `.jsonl` files below Pi's configured session root,
validate the session header, reconstruct only the active branch, and import one
RecallBase conversation for each session header ID. Import only:

- the header session ID, created time, working directory, optional parent-session
  provenance, latest session name, and latest model on the active branch;
- direct `user` message text; and
- user-visible `assistant` text.

Do **not** import thinking, tool calls, tool results, bash execution output,
extension/custom content, compaction or branch summaries, labels, settings
changes, usage/cost data, file contents, absolute attachment paths, or base64
image bytes. Replace image blocks with `[image]` and Pi-generated `<file
name="...">...</file>` prompt blocks with `[file]` before indexing.

This boundary is smaller and safer than Pi's LLM context: session files can
contain source files, shell output, absolute local paths, extension-owned
payloads, provider response IDs, opaque reasoning signatures, and base64 media.
Pi's official type definitions explicitly separate user/assistant text,
thinking, tool calls, and tool-result messages.
[`pi-ai message types`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/ai/src/types.ts#L329-L423)

Do not depend on invoking `pi`, on the SDK's `SessionManager`, or on HTML export
in production. Direct JSONL reading is offline and has no model/provider
dependency; it also avoids Pi's migrate-on-open behavior, which can rewrite
v1/v2 files. Pi exposes the schema in public documentation, while CLI export is
HTML-oriented and there is no CLI operation that emits a complete machine-
readable inventory of every session.
[`session format`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/docs/session-format.md#L1-L27),
[`migration on open`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/core/session-manager.ts#L895-L922),
[`CLI modes`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/README.md#L536-L545)

## Product, version, and supported surfaces

The installed `pi` executable resolves to the official npm package
`@earendil-works/pi-coding-agent@0.81.1`; both `pi --version` and its package
manifest report `0.81.1`. A privacy-safe shape scan of the local installation
found 29 session files, all with a v3 header, and observed the documented
`session`, `model_change`, `thinking_level_change`, `message`, and
`session_info` records. It observed only `user`, `assistant`, and `toolResult`
message roles and `text`, `thinking`, and `toolCall` content blocks. No local
message text, paths, arguments, results, or media bytes were read into this
document.

Pi is an actively maintained terminal coding harness, not a deprecated API.
The official repository and release feed had no sunset or deprecation notice;
the review did find active schema development described under "Forward
compatibility" below. Pi supports interactive, print, JSON-event, RPC, and SDK
modes. JSON and RPC are live process-integration protocols, not saved-history
enumeration interfaces.
[`product overview and modes`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/README.md#L15-L19),
[`official releases`](https://github.com/earendil-works/pi/releases)

The latest released durable-harness design makes old coding-agent v3 JSONL the
**only** explicit backward-compatibility requirement; it warns that other
harness and SQLite formats/APIs may break. That is strong first-party support
for depending on the documented v3 artifact while avoiding Pi runtime APIs.
[`v0.83.0 compatibility policy`](https://github.com/earendil-works/pi/blob/v0.83.0/packages/agent/docs/harness-v2.md#L1-L4)

The relevant commands and options are:

| Surface | Meaning | Importer use |
| --- | --- | --- |
| `pi`, `pi -p`, `--mode json`, `--mode rpc` | Interactive, one-shot, event-stream, and RPC execution | None; these run an agent rather than enumerate local history |
| `-c` / `--continue`, `-r` / `--resume` | Continue or select a saved session | Confirms local saved-session product surface |
| `--session <path\|id>`, `--session-id <id>` | Open/create a named session | Header ID remains the conversation identity |
| `--fork <path\|id>`, `/fork`, `/clone` | Copy history into a new session file | New header ID is a new conversation; copied entry IDs can repeat across conversations |
| `--session-dir <dir>` | Override session storage | Cannot be inferred after that process exits; expose RecallBase custom roots |
| `--no-session` | Ephemeral execution | Nothing to import |
| `--name`, `/name` | Append session display metadata | Use latest non-empty session name |
| `/tree` | Move within the append-only conversation tree | Follow the persisted active leaf, not every branch |
| `/compact` | Add a lossy summary while retaining full JSONL history | Ignore synthetic summary and import original active-branch messages |
| `/export [file]`, `--export <in> [out]` | Interactive JSONL/HTML copy or CLI HTML export | Optional differential test oracle only |
| `/import <file>` | Resume an imported Pi JSONL file | Reinforces that JSONL is Pi's portable session artifact |

Pi documents the session flags and their meanings in the
[`CLI reference`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/README.md#L536-L584)
and documents tree, fork, clone, compact, export, and import in the
[`interactive command table`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/README.md#L172-L199).

## Storage, overrides, and cross-platform discovery

### Default and custom roots

The default layout is:

```text
~/.pi/agent/                              # default PI_CODING_AGENT_DIR
└── sessions/
    └── --<encoded-working-directory>--/
        └── <ISO-time-with-dashes>_<session-uuid>.jsonl
```

The config root is `join(os.homedir(), ".pi", "agent")`, so the same rule is
portable to macOS, Linux, and Windows. `PI_CODING_AGENT_DIR` replaces the whole
config root. Under the default config root, Pi creates `sessions/<cwd-bucket>`.
[`config path source`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/config.ts#L490-L560)

The session-directory precedence used by Pi is:

1. process-only `--session-dir`;
2. `PI_CODING_AGENT_SESSION_DIR`;
3. `sessionDir` in the effective Pi settings; then
4. `<PI_CODING_AGENT_DIR>/sessions`.

Pi accepts absolute, relative, and `~`-prefixed `sessionDir` values.
[`settings documentation`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/docs/settings.md#L200-L210),
[`runtime precedence`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/main.ts#L568-L578)

RecallBase discovery should use, in order:

1. explicit importer `roots` when provided;
2. the current `PI_CODING_AGENT_SESSION_DIR` when non-empty;
3. an absolute or `~`-prefixed `sessionDir` in global Pi settings under the
   effective agent root;
4. `<PI_CODING_AGENT_DIR>/sessions`, or `~/.pi/agent/sessions` by default.

Also inspect direct `*.jsonl` children of the agent root as a narrowly scoped
legacy fallback. Pi v0.30.0 briefly wrote files there and its startup migration
moves them into the normal cwd buckets. This fallback should be de-duplicated
by header session ID and can be removed only after the supported Pi version
floor excludes unmigrated v0.30.0 data.
[`official misplaced-session migration`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/migrations.ts#L75-L129)

`--session-dir` and project-local/relative settings from a past Pi process
cannot be discovered reliably after that process exits. The correct interface
for those cases is RecallBase's existing explicit `roots`, not a filesystem-
wide search.

Match Pi's own bounded enumeration: under the default sessions root, inspect
one cwd-bucket directory level and then direct `*.jsonl` children; when a custom
session directory is supplied, inspect only its direct `*.jsonl` children.
Avoid recursive collection outside this documented shape. Pi's `listAll()`
implements exactly these two cases.
[`official listAll boundaries`](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/src/core/session-manager.ts#L1632-L1711)

### Do not decode cwd bucket names

For the normal layout, Pi resolves the cwd, removes one leading slash or
backslash, and replaces `/`, `\`, and `:` with `-`. This encoding is lossy:
different paths can map to the same text and a bucket is not an authoritative
working-directory value. Walk session-root children for `.jsonl` files and
read `header.cwd`; do not recreate or reverse the bucket algorithm.
[`bucket implementation`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/core/session-manager.ts#L472-L488)

Validate candidates by their first parsed object, not filename alone. A v1-v3
candidate has `type: "session"` and a non-empty string `id`; current v3 also has
an ISO `timestamp`, a string `cwd`, and `version: 3`. This prevents unrelated
JSONL under custom roots from being claimed as Pi.
[`released v3 header parser`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/agent/src/harness/session/jsonl-storage.ts#L65-L100)

## Released v1-v3 JSONL contract

Each non-header v2/v3 entry has a string `type`, unique entry `id`, nullable
`parentId`, and ISO timestamp. The header is metadata, not a tree entry. Version
1 is a legacy linear sequence with no IDs; v2 added tree IDs; v3 renamed the
legacy `hookMessage` message role to `custom`.
[`session versions`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/docs/session-format.md#L19-L27),
[`entry base and header`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/core/session-manager.ts#L30-L56)

### Header

```json
{"type":"session","version":3,"id":"019...","timestamp":"2026-08-21T01:02:03.000Z","cwd":"/work/project","parentSession":"/optional/source.jsonl"}
```

| Field | Meaning | RecallBase use |
| --- | --- | --- |
| `id` | Session identity, normally UUIDv7 in current Pi | `conversation.upstreamId`; required |
| `timestamp` | Session creation time, ISO string | `startedAt`; fall back to earliest imported message/file time if malformed |
| `cwd` | Resolved working directory at session creation | provenance metadata only; never title/search text |
| `parentSession` | Source file path for fork/clone | parent provenance only; do not index or print raw path |
| `metadata` | New-harness/application-owned open object | ignore unless a future documented Pi field is needed |

Pi's v3 harness parser explicitly treats `metadata` as opaque and optional.
[`v3 header and metadata`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/agent/src/harness/session/jsonl-storage.ts#L15-L23),
[`metadata projection`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/agent/src/harness/session/jsonl-storage.ts#L138-L146)

### Entry types

| `type` | Relevant shape | Import behavior |
| --- | --- | --- |
| `message` | `message: AgentMessage` | Consider only active-branch `user` and `assistant` messages |
| `model_change` | `provider`, `modelId` | Active-branch model fallback/provenance, not a message |
| `thinking_level_change` | `thinkingLevel` | Skip |
| `active_tools_change` | `activeToolNames[]` | Skip |
| `compaction` | `summary`, `tokensBefore`, old `firstKeptEntryId?`, new `retainedTail?` | Skip summary and retained tail; raw active ancestors remain authoritative for history import |
| `branch_summary` | `fromId`, `summary` | Skip synthetic summary |
| `custom` | `customType`, arbitrary `data` | Skip extension state |
| `custom_message` | extension `content`, `display`, arbitrary `details` | Skip, including visible ones, because it is extension-generated context rather than direct user input |
| `label` | `targetId`, latest label | Skip |
| `session_info` | optional `name` | Latest non-empty value is preferred title; an empty latest value clears the title |
| `leaf` | `targetId: string \| null` | Active-leaf cursor record; do not treat its own `id` as a conversation node |
| unknown | open record | Ignore and emit schema/unknown-record diagnostics without aborting other sessions |

The coding-agent schema defines the established entries.
[`coding-agent entry union`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/core/session-manager.ts#L58-L156)
The released harness adds `active_tools_change`, optional `retainedTail`, and
the explicit `leaf` cursor while retaining the same v3 header.
[`harness v3 entry union`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/agent/src/harness/types.ts#L343-L432)

### Message schema and text extraction

| Role/block | Stored data | Import behavior |
| --- | --- | --- |
| `user.content: string` | Direct prompt or Pi-produced file wrapper text | Strip file wrappers, retain remaining non-empty text |
| `user.content[].text` | Direct prompt text | Join in array order |
| `user.content[].image` | `mimeType` plus base64 `data` | Add `[image]`; never copy/inspect `data` |
| `assistant.content[].text` | User-visible reply text | Join in array order; preserve one assistant entry as one message |
| `assistant.content[].thinking` | Reasoning plus optional opaque signature | Skip both text and signature |
| `assistant.content[].toolCall` | tool name, ID, arguments, provider signature | Skip |
| `toolResult` | tool name/ID, text/image result, arbitrary `details` | Skip entire message |
| `bashExecution` | command, output, exit state, full-output path | Skip entire message |
| `custom`, `branchSummary`, `compactionSummary` | extension or generated context | Skip entire message |
| unknown role/block | future/provider extension | Skip with diagnostic; do not stringify arbitrary objects into search text |

User message timestamps and assistant/tool-result timestamps are Unix
milliseconds inside `message`; entry timestamps are ISO strings. Prefer a
finite message timestamp for an imported message and fall back to the enclosing
entry timestamp. Pi's own session-list projection uses exactly that precedence
for user/assistant activity.
[`message timestamp types`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/ai/src/types.ts#L384-L423),
[`official timestamp fallback`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/core/session-manager.ts#L673-L684)

Pi's `@file` processor embeds text-file bytes and absolute paths directly into
the user prompt as `<file name="absolute-path">...</file>`. Images are stored as
base64 `ImageContent` plus a similar text reference. RecallBase should replace
each complete Pi-generated file wrapper with `[file]` and then add `[image]` for
each image block. This prevents source/secret/path indexing and avoids counting
one image twice as content. Limit wrapper recognition to the documented
`<file name="...">...</file>` form and process it before joining text parts.
[`official file processor`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/cli/file-processor.ts#L23-L86)

For a message upstream ID, use the entry `id`; for v1/malformed legacy entries
without one, use a deterministic physical-line fallback such as `L<line>`.
Copied entry IDs are expected across forked session files, so IDs are scoped to
the header conversation ID, not globally.

## Branch, fork, and compaction semantics

### Active branch reducer

Pi stores a tree, not a chronological flat transcript. Importing every physical
`message` line would include abandoned alternatives and duplicate shared
ancestors. Reconstruct the active branch as follows:

1. Parse entries in physical append order and index tree-bearing entries by
   `id`.
2. For a `leaf` record, set the cursor to its `targetId` (`null` means no active
   entries). For every other valid tree entry, set the cursor to that entry's
   `id`. Thus the last cursor-affecting record determines the persisted active
   leaf.
3. Starting at the cursor, follow `parentId` to `null`, cycle-checking and
   requiring every referenced parent to exist.
4. Reverse that path and select only `message` entries with role `user` or
   `assistant`.

This is the official v3 harness rule: ordinary appends advance the leaf to the
entry ID, while a `leaf` record points to its `targetId`.
[`leaf reducer`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/agent/src/harness/session/jsonl-storage.ts#L128-L135),
[`load and cursor update`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/agent/src/harness/session/jsonl-storage.ts#L162-L184)
The original coding-agent implementation uses the last appended entry as leaf
and walks `parentId` to the root.
[`coding-agent branch walk`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/core/session-manager.ts#L325-L360)

A missing parent, duplicate ID, parent cycle, or `leaf.targetId` that does not
exist means the active transcript cannot be established safely. Emit a
session-scoped diagnostic and skip that conversation instead of falling back to
physical order and accidentally importing abandoned/private content.

### Forks and clones

`/fork`, `/clone`, and `--fork` create a new header/session ID and copy a branch
or complete source entries into a new JSONL file; the new header points to the
source through `parentSession`. Pi intentionally retains the copied entry IDs.
Therefore header ID is the conversation identity, while message entry ID is
only stable within that conversation.
[`branch-file creation`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/core/session-manager.ts#L1407-L1442),
[`cross-project fork copy`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/core/session-manager.ts#L1572-L1629)

### Compaction

Compaction is a context checkpoint, not deletion: Pi explicitly says full
history remains in the JSONL file. For history import, traverse the full active
ancestor chain and ignore `compaction.summary`, `branch_summary.summary`, and
`retainedTail`. Applying Pi's LLM-context reducer would intentionally discard
older raw history; importing both raw messages and `retainedTail` would
duplicate messages.
[`documented full-history retention`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/README.md#L271-L279),
[`compaction checkpoint variants`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/docs/session-format.md#L227-L246)

## Metadata projection

Use these deterministic rules:

- `upstreamId`: header `id`;
- `rawUri`: file URI for the JSONL file, with the session ID as a fragment only
  if consistent with existing importer conventions;
- `startedAt`: valid header timestamp, else earliest imported message time, else
  file mtime;
- `updatedAt`: latest imported user/assistant message time, else header time,
  else file mtime;
- `title`: latest `session_info.name` in physical append order when non-empty;
  otherwise normalized first active-branch user text; otherwise the existing
  source/session fallback helper;
- `modelId`: last active-branch `model_change.modelId`, overridden by the last
  active-branch assistant `message.model` when present;
- `metadata`: working directory and parent provenance only if RecallBase already
  has a non-indexed, privacy-safe field; never concatenate either path into
  title or searchable text.

Pi itself scans all entries for the latest session name, extracts only
user/assistant text for list search, and prefers message timestamps to entry
timestamps.
[`official session-info projection`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/core/session-manager.ts#L687-L760)

## Compatibility and error policy

### Released v1-v3

- Accept a missing header `version` as v1. Treat non-header records as a linear
  active path and synthesize deterministic line IDs; do not rewrite the source.
- For v2, use `id`/`parentId`; treat legacy `hookMessage` as internal/custom and
  skip it. Pi's own v2-to-v3 migration only performs that rename.
- For v3, allow unknown header properties, record types, message properties,
  roles, and content blocks. The documented schema contains extension-owned
  open objects, so exact-key validation would be brittle.
- Skip blank lines. Treat an incomplete final JSON line as a recoverable torn
  append with a warning. Report malformed non-final lines; continue parsing the
  file only when a safe active parent chain can still be established.
- Never call Pi's migration APIs on user data. Official migration generates new
  random entry IDs for v1 and rewrites the file, which a read-only importer must
  not do.

Pi's official migration source documents the v1 linear-to-tree conversion and
v2 `hookMessage` rename.
[`v1-v3 migrations`](https://github.com/earendil-works/pi/blob/20be4b18d4c57487f8993d2762bace129f0cf7c6/packages/coding-agent/src/core/session-manager.ts#L230-L295)

### Forward compatibility: unreleased v4

No Pi API/sunset deprecation was found, but a material breaking schema change
is already present on official `main`: the development package reports 0.84.2
and defines JSONL format v4. A v4 header is
`{kind:"header",version:4,id,createdAt,cwd,...}`; timestamps and sequence are
integer milliseconds; subsequent lines are discriminated by `kind` (`entry`,
`record`, `lane`, or `fact`); entries and orchestration records are interleaved;
and active branch state is a named lane/ref rather than an implicit single
leaf. The v4 codec enumerates these mutations and validates `seq` and timestamp.
[`v4 header`](https://github.com/earendil-works/pi/blob/5cd93f688aaab89dbb6dfa4aca535f21796ae185/packages/agent/src/harness/session/jsonl/types.ts#L20-L57),
[`v4 codec`](https://github.com/earendil-works/pi/blob/5cd93f688aaab89dbb6dfa4aca535f21796ae185/packages/agent/src/harness/session/jsonl/codec.ts#L7-L26),
[`v4 mutations`](https://github.com/earendil-works/pi/blob/5cd93f688aaab89dbb6dfa4aca535f21796ae185/packages/agent/src/harness/session/jsonl/codec.ts#L131-L217)

Pi's own implementation specification says v3 files load unchanged and are
rewritten to v4 only before the first append; read-only opens do not rewrite.
It also states that v4 keeps one JSON object per line but interleaves harness
records and uses per-ref leaf state.
[`v4 compatibility decision`](https://github.com/earendil-works/pi/blob/5cd93f688aaab89dbb6dfa4aca535f21796ae185/packages/agent/docs/harness.md#L450-L460),
[`v3 read and v4 rewrite behavior`](https://github.com/earendil-works/pi/blob/5cd93f688aaab89dbb6dfa4aca535f21796ae185/packages/agent/docs/harness.md#L2008-L2016)

For the first implementation, keep v3 and v4 decoding behind a header-version
dispatch seam. Fully implement v1-v3 now. If a v4 file is discovered before a
sanitized released v4 fixture is added, report a targeted
`pi_session_version_unsupported` diagnostic rather than interpreting it as v3.
This is intentionally preferable to speculative partial support for an
unreleased schema. Add a v4 decoder later without changing discovery, text
normalization, branch projection, or RecallBase mapping.

## Implementation shape and DRY boundary

Keep the Pi-specific module small:

```text
discover roots -> validate header/version -> stream format decoder
  -> active-branch entry projection -> shared visible-text normalizer
  -> existing title/date/import-batch helpers
```

The worthwhile shared abstraction is one Pi visible-message normalizer used by
both the v3 and future v4 decoder. It owns the business rule that only direct
user and user-visible assistant text is indexed and that files/images/tools/
thinking are redacted. Duplicating that rule in two format decoders could drift
and create privacy regressions. Do not abstract the small, materially different
v3/v4 header and leaf reducers merely to reduce line count.

Reuse RecallBase's existing `findFiles`, `streamJsonl`, path/date/schema
fingerprint, title fallback, diagnostic, and import-batch patterns. Do not add a
Pi runtime dependency: it is large, version-couples RecallBase to Pi internals,
and its public open path can migrate/rewrite old sessions.

## Required sanitized fixtures and tests

A production-ready importer needs the following fixtures/tests:

1. **Installed v3 baseline:** v3 header; string and array user content; assistant
   text; Unix-ms message timestamps and ISO entry timestamps; latest model and
   `session_info` title.
2. **Privacy blocks:** assistant thinking, opaque signatures, tool calls with a
   unique secret, tool result text/image/details with a unique secret,
   `bashExecution`, visible/hidden custom messages, compaction and branch
   summaries. None of the unique values may be imported or searchable.
3. **Attachments:** one Pi `<file name>` wrapper containing a private-path and
   private-content sentinel plus one base64 image sentinel. Output contains only
   `[file]`/`[image]`; sentinels and mime bytes are absent from normalized data,
   diagnostics, and schema samples.
4. **Tree branch:** shared root with abandoned and active children. Only the
   active branch appears; a unique abandoned-branch sentinel is absent.
5. **Explicit leaf:** append a `leaf` record that moves back to an older branch;
   honor `targetId` rather than the leaf record ID or final message line.
6. **Compaction:** original ancestor messages plus `firstKeptEntryId`, and a
   second fixture with `retainedTail`. Original active messages appear once;
   summaries and retained duplicates are absent.
7. **Fork/clone:** two headers with different session IDs and copied entry IDs.
   Produce two conversations without cross-conversation message collision and
   without indexing `parentSession` paths.
8. **Legacy versions:** v1 linear records without IDs; v2 tree with
   `hookMessage`; verify deterministic fallback IDs and no source rewrite.
9. **Corruption:** blank lines, unknown record/block, incomplete final line,
   malformed middle line, duplicate ID, missing parent, cycle, and missing leaf
   target. One bad session must not abort other sessions.
10. **Discovery:** default root, `PI_CODING_AGENT_DIR`,
    `PI_CODING_AGENT_SESSION_DIR`, global `sessionDir`, explicit roots, legacy
    agent-root file, unrelated JSONL, Windows-style cwd/bucket, and duplicate
    header ID.
11. **Incremental re-import:** append a new active user/assistant turn; confirm
    stable conversation/message upstream IDs and no duplicate messages.
12. **Version gate:** a minimal official-main v4 header produces the explicit
    unsupported-version diagnostic until a released v4 decoder and fixture are
    added.

For differential tests only, copy fixtures into a temporary directory and
compare the selected v3 active branch with Pi's official session storage/
`SessionManager`. Never run that oracle against the user's original files,
because old versions can be migrated and rewritten on open.

## Acceptance checks on the reviewed machine

After implementation, the installation/debug sequence should verify:

1. `pi --version` is detected only as an informational smoke check; importing
   must still work when `pi` is not on `PATH`.
2. Import a generated/sanitized v3 fixture and run targeted importer, CLI JSON,
   and search tests.
3. Point discovery at the local default Pi root and confirm the importer finds
   the same 29 valid v3 headers without logging conversation text, cwd values,
   tool arguments/results, file paths, or image bytes.
4. Run a real local import into a temporary RecallBase database and verify
   source health, conversation/message counts, idempotent second import, and
   search absence for fixture privacy sentinels.
5. Run the full importer/CLI test suites and package typecheck/lint commands used
   by this repository.
