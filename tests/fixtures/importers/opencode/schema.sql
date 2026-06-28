CREATE TABLE workspace (
  id TEXT PRIMARY KEY,
  directory TEXT
);

CREATE TABLE project (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  directory TEXT
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  title TEXT,
  workspace_id TEXT,
  project_id TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE message (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  role TEXT,
  created_at TEXT,
  content TEXT
);

CREATE TABLE part (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  type TEXT,
  text TEXT
);
