CREATE TABLE IF NOT EXISTS encrypted_conversation_chunks_v2 (
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

INSERT OR REPLACE INTO encrypted_conversation_chunks_v2
SELECT
  user_id,
  device_id,
  batch_id,
  conversation_id,
  chunk_id,
  part_index,
  part_count,
  message_count,
  key_id,
  key_version,
  algorithm,
  iv_base64url,
  content_hash_base64url,
  encrypted_at,
  object_key,
  completed
FROM encrypted_conversation_chunks;

DROP TABLE encrypted_conversation_chunks;
ALTER TABLE encrypted_conversation_chunks_v2 RENAME TO encrypted_conversation_chunks;

CREATE INDEX IF NOT EXISTS encrypted_conversation_chunks_lookup_idx
  ON encrypted_conversation_chunks (user_id, device_id, conversation_id, completed, part_index);

CREATE INDEX IF NOT EXISTS encrypted_conversation_chunks_batch_idx
  ON encrypted_conversation_chunks (user_id, device_id, batch_id);
