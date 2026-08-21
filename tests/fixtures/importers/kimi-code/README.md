Sanitized Kimi Code session fixture.

- Layout mirrors the documented `sessions/<workDirKey>/<sessionId>/state.json` and `agents/main/wire.jsonl` format.
- Records cover user-visible prompts, assistant text, thinking, tool calls/results, system injections, and migrated assistant messages.
- Thinking, tool payloads/results, and internal injections contain sentinel text that tests assert is not indexed.
- Based on the official session documentation and `agent-core` wire transcript reducer; no real conversation data is included.

Primary sources:

- https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/guides/sessions.md
- https://github.com/MoonshotAI/kimi-code/blob/main/packages/agent-core/src/services/message/transcript.ts
