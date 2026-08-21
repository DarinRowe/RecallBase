Sanitized Pi session fixture.

- Layout mirrors the documented `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<uuid>.jsonl` format.
- Records cover the version 3 session tree, an abandoned branch, session naming, model changes, images, thinking, tool calls/results, compaction, branch summaries, and extension messages.
- Thinking, tool payloads/results, summaries, abandoned branches, and extension content contain sentinel text that tests assert is not indexed.
- No real prompts, local paths, project names, credentials, file contents, or tool output are included.

Primary sources:

- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts
