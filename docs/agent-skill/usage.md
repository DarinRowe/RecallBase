# Agent Integration

RecallBase's canonical Agent contract is CLI JSON over imported conversation data. Agents use `rb` mainly to search and recover context from browser-extension imports and local AI tool imports. MCP is optional and mirrors the same local query layer.

## Command Loop

```bash
rb sources --json
rb today --json
rb search "sync retry" --json
rb open <conversation-id> --json
```

Use `today` for current continuity, `search` for targeted retrieval, and `open` for detail on one conversation. The JSON envelopes are stable and compact; raw upstream evidence is preserved locally but not dumped by default.

`sources` is a health check for imported data. If results look incomplete, check whether browser-extension captures or local AI tool sources have been imported recently.

When an Agent calls `today`, it should transform the JSON into a customer-facing answer about what the user did. The answer should group work into themes, mention concrete tasks and outcomes, and use IDs only as optional follow-up references. Do not respond to a "what did I do today?" prompt with only `conversationId` values or `rb open ...` hints.

When the `today` result is too terse, open the top relevant conversations and summarize the messages needed to explain the work. Keep raw JSON and full transcripts out of the final answer unless the user asks for them.

`rb open --json` message objects can include optional platform-visible `thinking` plus lightweight browser metadata such as `modelId`, `attachments`, `citations`, and `media`. Attachment/media URLs are sanitized and may omit token-like query details; treat those fields as supporting context, while `text` remains the main message content.

The integration test `tests/integration/agent-access.test.ts` verifies this workflow against fixture-backed data: import sources, check source health, read `today`, search for a continuation topic, and open the relevant conversation.

## When To Avoid RecallBase

Do not use RecallBase as a chat client, notes editor, broad knowledge graph, or autonomous sync trigger. Do not sync unless the user explicitly opts in with login and `rb sync`.

## MCP

`rb mcp` exposes local tools for `today`, `search`, `open`, `sources`, and `sync_status`. Tool responses are JSON envelopes generated from the same query functions as CLI JSON.
