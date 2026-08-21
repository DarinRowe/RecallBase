# Cursor importer fixture provenance

The Cursor importer tests generate sanitized JSONL fixtures at runtime instead
of checking conversation content into Git.

The fixture layout and fields are based on:

- Cursor's official Hooks v1 transcript path and conversation identity:
  https://cursor.com/docs/hooks
- Cursor's official local Desktop history boundary:
  https://cursor.com/docs/agent/chat/history
- Cursor Desktop `3.15.6` and Agent CLI `2026.08.04-aaa8809`, whose current
  first-party local artifacts share main transcripts under
  `~/.cursor/projects/*/agent-transcripts/<uuid>/<uuid>.jsonl`.

Fixtures cover direct user/assistant text, multiple text blocks, tool/status
exclusion, duplicate UUIDs, subagent exclusion, incomplete tails, malformed
interior records, unknown content types, empty transcripts, and symlink escape
prevention.
