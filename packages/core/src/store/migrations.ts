import type { Database } from "bun:sqlite";

export function migrate(db: Database): void {
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");

  db.run(`
    CREATE TABLE IF NOT EXISTS source_status (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      health TEXT NOT NULL,
      confidence TEXT NOT NULL,
      confidence_reason TEXT NOT NULL,
      last_import_at TEXT,
      conversations INTEGER NOT NULL DEFAULT 0,
      messages INTEGER NOT NULL DEFAULT 0,
      raw_evidence INTEGER NOT NULL DEFAULT 0,
      cursor TEXT,
      schema_fingerprint TEXT,
      source_version TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS raw_evidence (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      uri TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(source_id, content_hash)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_label TEXT NOT NULL,
      upstream_id TEXT,
      title TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      raw_evidence_refs_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      upstream_id TEXT,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      text TEXT NOT NULL,
      thinking TEXT,
      model_id TEXT,
      upstream_ids_json TEXT NOT NULL DEFAULT '[]',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      citations_json TEXT NOT NULL DEFAULT '[]',
      media_json TEXT NOT NULL DEFAULT '[]',
      raw_evidence_id TEXT REFERENCES raw_evidence(id)
    )
  `);
  ensureColumn(db, "messages", "updated_at", "TEXT");
  ensureColumn(db, "messages", "thinking", "TEXT");
  ensureColumn(db, "messages", "model_id", "TEXT");
  ensureColumn(db, "messages", "upstream_ids_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "messages", "attachments_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "messages", "citations_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "messages", "media_json", "TEXT NOT NULL DEFAULT '[]'");

  db.run(`
    CREATE TABLE IF NOT EXISTS parser_diagnostics (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      severity TEXT NOT NULL,
      code TEXT NOT NULL,
      message TEXT NOT NULL,
      evidence_ref TEXT,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts
    USING fts5(conversation_id UNINDEXED, message_id UNINDEXED, title, content)
  `);

  db.run("CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages(conversation_id)");
  db.run("CREATE INDEX IF NOT EXISTS conversations_source_id_idx ON conversations(source_id)");
  db.run("CREATE INDEX IF NOT EXISTS conversations_source_upstream_idx ON conversations(source_id, upstream_id)");
  db.run("CREATE INDEX IF NOT EXISTS conversations_source_capture_signature_idx ON conversations(source_id, json_extract(metadata_json, '$.captureSignature'))");
  db.run("CREATE INDEX IF NOT EXISTS conversations_started_at_idx ON conversations(started_at)");
  db.run("CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON conversations(updated_at)");
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
