Sanitized Claude web export fixture.

Shape covered:
- Official export-style `conversations.json` array.
- Conversation objects with `uuid`, `name`, `summary`, timestamps, and `chat_messages`.
- Message objects with `sender`, `text`, `content`, attachments, files, and timestamps.
- Assistant content may include non-visible thinking blocks; importer preserves visible text only.

No real prompts, account data, project names, tokens, or file contents are included.
