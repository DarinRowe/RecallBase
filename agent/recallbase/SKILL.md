---
name: recallbase
description: Use RecallBase CLI JSON to answer questions about prior AI work history and recover useful context before continuing work.
---

# RecallBase Agent Usage

Use RecallBase when the user asks what happened earlier, what they worked on today, where a prior decision came from, or when current work depends on earlier AI/coding sessions.

RecallBase is for end-user memory recovery. Your answer should be useful to a regular customer, not a raw database report.

Prefer compact JSON commands:

```bash
rb sources --json
rb today --json
rb search "error message or feature name" --json
rb open <conversation-id> --json
```

Guidelines:

- Start with `rb today --json` when the user asks "what did I do today?", "today", "what happened earlier today?", or wants same-day continuity.
- For `today`, answer with a concise natural-language summary of what the user worked on. Group sessions into themes, mention concrete tasks and outcomes, and only include IDs or `rb open ...` commands as optional follow-up references.
- Do not answer a `today` request by only listing conversation IDs, session IDs, or continuation hints. IDs are internal handles; the user asked what happened.
- Use `rb search --json` for a specific bug, feature, branch, file, command, or error.
- Use `rb open --json` only for the few conversations needed to understand details behind a `today` or `search` result. Summarize the relevant messages instead of dumping full transcripts.
- `rb open --json` message objects can include optional `thinking` for platform-visible reasoning blocks and optional lightweight metadata (`modelId`, `upstreamIds`, `attachments`, `citations`, `media`) from browser API captures. Attachment/media URLs are sanitized and may omit token-like query details. Treat `thinking` as separate from `text`; use metadata as context, not as a replacement for message content.
- Check `rb sources --json` when results seem incomplete.
- Local RecallBase commands do not require login. Do not run `rb sync` unless the user explicitly asks for sync.
- Treat synced Web data as bounded metadata/snippets/summaries, not a full local transcript.
- Local CLI imports are message-first. A source can be healthy with `rawEvidence: 0`; use conversations and messages as the primary signal.

When answering users:

- Prefer "You worked on..." / "The main threads were..." phrasing.
- Include decisions, fixes, tests, merged PRs, or next steps when they are visible in the returned data.
- Say when results may be incomplete because sources are absent, partial, or not recently imported.
- Keep command output and JSON out of the final answer unless the user explicitly asks for raw data.
