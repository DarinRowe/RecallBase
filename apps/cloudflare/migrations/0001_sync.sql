CREATE TABLE IF NOT EXISTS sync_devices (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  remote_cursor TEXT,
  last_sync_at TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  uploaded_search_documents INTEGER NOT NULL DEFAULT 0,
  uploaded_encrypted_raw_blobs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS completed_batches (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  cursor TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id, batch_id)
);

CREATE TABLE IF NOT EXISTS search_documents (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  snippet TEXT NOT NULL,
  optional_summary TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS search_documents_user_completed_idx
  ON search_documents (user_id, completed, updated_at);

CREATE INDEX IF NOT EXISTS search_documents_user_conversation_idx
  ON search_documents (user_id, conversation_id);
