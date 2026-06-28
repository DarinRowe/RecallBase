import type { Database } from "bun:sqlite";
import { defaultDbPath } from "../config";
import type { CommandContext } from "./shared";

const AUTO_REFRESH_INTERVAL_MS = 30_000;
const AUTO_REFRESH_STATE_KEY = "cli:auto_refresh:last_import_at";

export async function refreshBeforeQuery(context: CommandContext): Promise<void> {
  if (context.flags.noRefresh || context.flags.dbPathExplicit || context.flags.roots.length > 0 || context.flags.dbPath !== defaultDbPath()) return;

  const sourceIds = context.flags.sourceIds.length > 0 ? context.flags.sourceIds : undefined;
  const stateKey = refreshStateKey(sourceIds);
  ensureSourceStateTable(context.db.db);
  const lastRefresh = getSourceState(context.db.db, stateKey);
  if (!context.flags.force && lastRefresh !== undefined && Date.now() - Date.parse(lastRefresh) < AUTO_REFRESH_INTERVAL_MS) return;

  const { importKnownSources } = await import("@recallbase/importers");
  const options: NonNullable<Parameters<typeof importKnownSources>[1]> = { skipUnchanged: true };
  if (sourceIds !== undefined) options.sourceIds = sourceIds;
  await importKnownSources(context.db, options);
  setSourceState(context.db.db, stateKey, new Date().toISOString());
}

function refreshStateKey(sourceIds: string[] | undefined): string {
  if (sourceIds === undefined || sourceIds.length === 0) return AUTO_REFRESH_STATE_KEY;
  return `${AUTO_REFRESH_STATE_KEY}:${[...sourceIds].sort().join(",")}`;
}

function ensureSourceStateTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS source_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

function getSourceState(db: Database, key: string): string | undefined {
  return (db.query("SELECT value FROM source_state WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

function setSourceState(db: Database, key: string, value: string): void {
  db.run(
    `INSERT INTO source_state (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, new Date().toISOString()]
  );
}
