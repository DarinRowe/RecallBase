ALTER TABLE sync_devices ADD COLUMN uploaded_encrypted_conversation_chunks INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS encrypted_conversation_chunks (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  part_index INTEGER NOT NULL,
  part_count INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  key_id TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  algorithm TEXT NOT NULL,
  iv_base64url TEXT NOT NULL,
  content_hash_base64url TEXT NOT NULL,
  encrypted_at TEXT NOT NULL,
  object_key TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, device_id, conversation_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS encrypted_conversation_chunks_lookup_idx
  ON encrypted_conversation_chunks (user_id, device_id, conversation_id, completed, part_index);

CREATE INDEX IF NOT EXISTS encrypted_conversation_chunks_batch_idx
  ON encrypted_conversation_chunks (user_id, device_id, batch_id);
