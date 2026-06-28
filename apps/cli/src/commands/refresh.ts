import { defaultDbPath } from "../config";
import type { CommandContext } from "./shared";

const AUTO_REFRESH_INTERVAL_MS = 30_000;
const AUTO_REFRESH_STATE_KEY = "cli:auto_refresh:last_import_at";

export async function refreshBeforeQuery(context: CommandContext): Promise<void> {
  if (context.flags.noRefresh || context.flags.dbPathExplicit || context.flags.roots.length > 0 || context.flags.dbPath !== defaultDbPath()) return;

  const sourceIds = context.flags.sourceIds.length > 0 ? context.flags.sourceIds : undefined;
  const stateKey = refreshStateKey(sourceIds);
  const lastRefresh = context.db.getSyncState(stateKey);
  if (!context.flags.force && lastRefresh !== undefined && Date.now() - Date.parse(lastRefresh) < AUTO_REFRESH_INTERVAL_MS) return;

  const { importKnownSources } = await import("@recallbase/importers");
  const options: NonNullable<Parameters<typeof importKnownSources>[1]> = { skipUnchanged: true };
  if (sourceIds !== undefined) options.sourceIds = sourceIds;
  await importKnownSources(context.db, options);
  context.db.setSyncState(stateKey, new Date().toISOString());
}

function refreshStateKey(sourceIds: string[] | undefined): string {
  if (sourceIds === undefined || sourceIds.length === 0) return AUTO_REFRESH_STATE_KEY;
  return `${AUTO_REFRESH_STATE_KEY}:${[...sourceIds].sort().join(",")}`;
}
