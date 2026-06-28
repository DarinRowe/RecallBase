Sanitized opencode SQLite fixture notes.

The test suite creates a temporary SQLite database using the schema in `schema.sql`.

Shape covered:
- `session`, `message`, `part`, `workspace`, and `project` tables.
- Workspace/project linkage and message parts.
- Missing optional workspace/project fields are tolerated.

No real prompts, paths, repository names, tokens, or account identifiers are included.
