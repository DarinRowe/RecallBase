# RecallBase Privacy Boundary

RecallBase V1 is local-first. Import, search, today, open, sources, and backup run entirely on your device without login or network access.

The Cursor local importer reads only main-agent transcripts from the current shared Cursor Desktop/Agent CLI project layout. It indexes direct user and assistant text, but does not index thinking, tool payloads or results, subagent transcripts, status/error records, terminal output, file contents, Desktop application state, derived search indexes, cloud-cache data, or credentials.

The Kimi Code local importer reads only main-agent session state and wire records. It indexes user-visible prompts and assistant-visible text, but does not index private thinking, tool payloads or results, subagent streams, system prompts, logs, tasks, or credentials.

The Grok Build local importer reads only `summary.json` metadata and the authoritative ACP `updates.jsonl` session stream. It indexes user-visible prompts and assistant-visible text, but does not index thought chunks, tool payloads or results, hooks, plans, tasks, system prompts, file snapshots, search indexes, or credentials.

The Pi local importer reads versioned JSONL session trees. It indexes only original user and assistant text on the active branch. Pi-generated file inputs and images are reduced to `[file]` and `[image]`; their paths, contents, and bytes are not indexed. Thinking, tool calls or results, bash output, compaction or branch summaries, abandoned branches, extension messages/state, and credentials are also excluded.

## Browser Extension

Browser extension capture follows the same local-first boundary. The supported sites are ChatGPT, Claude, Gemini, DeepSeek, Kimi, Qwen, Doubao, Tencent Yuanbao, Grok, Perplexity, NotebookLM, Google AI Studio, GitHub Copilot, and Microsoft Copilot.

Captures are saved in extension-local storage first. When the native messaging host is available, `rb extension-host` imports normalized conversations into the local RecallBase database. `rb extension install-host` installs the native messaging manifest, and `rb extension verify-host` checks that the browser can reach the host.

If the bridge is missing, the capture state is `queued bridge-missing`: saved in the extension, not imported to RecallBase yet, and not visible to local CLI or Agent queries until import succeeds.

Markdown download and Obsidian export work without the native messaging host. They run in the browser extension, use extension-local settings for the optional Obsidian folder/vault preference, and do not upload to any cloud service. Obsidian handoff uses clipboard plus an `obsidian://new` URI; the extension does not read local Obsidian vault configuration or require the Obsidian CLI.

## Logs

Logs must not include request bodies, raw evidence, search results, snippets, local file paths, or key material. Diagnostic logs should use redacted structured fields.
