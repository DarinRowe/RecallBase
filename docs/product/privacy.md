# RecallBase Privacy Boundary

RecallBase V1 is local-first. Import, search, today, and open can run without login, and no sync happens unless the user explicitly logs in and runs sync.

## Hybrid Private Mode

The default sync mode is Hybrid Private Mode.

- Raw source evidence and raw transcripts stay on the device and in local backups.
- Hosted RecallBase does not receive raw source evidence in V1.
- Normalized conversation messages sync as encrypted chunks. The hosted server stores encrypted chunk payloads and metadata, but not device-local decryption keys.
- Search metadata, bounded snippets, and optional summaries are readable by the server and Web viewer.
- Web V1 shows only synced readable documents. It cannot see unsynced local-only history.
- Raw cloud restore, cross-device raw backup, and full encrypted transcript unlock are not available in V1. Key sharing and full E2EE unlock are deferred.

## Readable Sync Surface

The backend may store these readable fields for Web search:

- conversation id and search document id
- source id and source label
- title
- started or updated timestamps
- bounded snippet
- optional summary when enabled
- source sync status and diagnostics

The backend must not store complete raw transcripts, raw local archives, full normalized message bodies, local source files, auth tokens, API keys, OAuth codes, state values, or raw encryption keys in readable search rows.

## Hosted Cloud Matrix

| Surface | Hosted cloud can read | Hosted cloud cannot receive/read |
| --- | --- | --- |
| CLI/Web search | Source, title, timestamps, bounded snippets, optional summaries, source/sync status | Raw local archives, raw CLI logs, raw browser DOM, local-only evidence |
| Synced detail | Readable metadata/snippet/summary and locked encrypted chunk availability | Full normalized messages unless a future explicit device-key unlock is added |
| Extension captures | Nothing until the user imports locally and later runs `rb sync` | Raw DOM/raw browser export archives in hosted V1 |

## Browser Extension

Browser extension capture follows the same local-first boundary. The supported sites are ChatGPT, Claude, Gemini, DeepSeek, Kimi, Qwen, Doubao, Tencent Yuanbao, Grok, Perplexity, NotebookLM, Google AI Studio, GitHub Copilot, and Microsoft Copilot.

Captures are saved in extension-local storage first. When the native messaging host is available, `rb extension-host` imports normalized conversations into the local RecallBase database. `rb extension install-host` installs the native messaging manifest, and `rb extension verify-host` checks that the browser can reach the host.

If the bridge is missing, the capture state is `queued bridge-missing`: saved in the extension, not imported to RecallBase yet, and not visible to local CLI or Agent queries until import succeeds.

Markdown download and Obsidian export work without the native messaging host. They run in the browser extension, use extension-local settings for the optional Obsidian folder/vault preference, and do not upload to RecallBase cloud. Obsidian handoff uses clipboard plus an `obsidian://new` URI; the extension does not read local Obsidian vault configuration or require the Obsidian CLI.

The extension and native messaging host do not upload directly to cloud. Cloud sync remains explicit: the user logs in and runs `rb sync`. After that, extension captures use the same Hybrid Private Mode sync surface as other sources: bounded readable search documents plus encrypted normalized conversation chunks, with raw evidence local-only.

## Encryption Keys

V1 raw encryption keys are device-local. Encrypted blobs include a key id and version so the CLI can tell whether the current device can decrypt them. Servers and other devices should report raw decryption as unavailable instead of pretending restore is complete.

## Logs

Logs must not include request bodies, raw evidence, ciphertext, search results, snippets, OAuth secrets, bearer tokens, auth codes, state values, or key material. Diagnostic logs should use redacted structured fields.
