import { homedir } from "node:os";
import { join } from "node:path";

export interface CliFlags {
  json: boolean;
  force: boolean;
  noRefresh?: boolean;
  dbPath: string;
  dbPathExplicit?: boolean;
  date?: string;
  query?: string;
  id?: string;
  limit?: number;
  roots: string[];
  sourceIds: string[];
  token?: string;
  syncUrl?: string;
  authPath: string;
  deviceKeyPath?: string;
  outPath?: string;
}

export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.RECALLBASE_DB ?? join(homedir(), ".recallbase", "recallbase.sqlite");
}

export function parseFlags(args: string[], env: NodeJS.ProcessEnv = process.env): { command: string; rest: string[]; flags: CliFlags } {
  const rest: string[] = [];
  const roots: string[] = [];
  const sourceIds: string[] = [];
  const flags: CliFlags = {
    json: false,
    force: false,
    noRefresh: false,
    dbPath: defaultDbPath(env),
    dbPathExplicit: false,
    authPath: env.RECALLBASE_AUTH_PATH ?? "",
    roots,
    sourceIds
  };
  if (env.RECALLBASE_SYNC_URL !== undefined) flags.syncUrl = env.RECALLBASE_SYNC_URL;
  if (env.RECALLBASE_DEVICE_KEY_PATH !== undefined) flags.deviceKeyPath = env.RECALLBASE_DEVICE_KEY_PATH;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const next = args[index + 1];
    if (arg === "--json") flags.json = true;
    else if (arg === "--force") flags.force = true;
    else if (arg === "--no-refresh") flags.noRefresh = true;
    else if (arg === "--db" && next) {
      flags.dbPath = next;
      flags.dbPathExplicit = true;
      index += 1;
    } else if (arg === "--date" && next) {
      flags.date = next;
      index += 1;
    } else if (arg === "--limit" && next) {
      flags.limit = Number.parseInt(next, 10);
      index += 1;
    } else if ((arg === "--source-root" || arg === "--root") && next) {
      roots.push(next);
      index += 1;
    } else if (arg === "--source" && next) {
      sourceIds.push(next);
      index += 1;
    } else if (arg === "--token" && next) {
      flags.token = next;
      index += 1;
    } else if (arg === "--sync-url" && next) {
      flags.syncUrl = next;
      index += 1;
    } else if (arg === "--auth-path" && next) {
      flags.authPath = next;
      index += 1;
    } else if (arg === "--device-key-path" && next) {
      flags.deviceKeyPath = next;
      index += 1;
    } else if ((arg === "--out" || arg === "-o") && next) {
      flags.outPath = next;
      index += 1;
    } else {
      rest.push(arg);
    }
  }

  const command = rest[0] ?? "help";
  return { command: command === "sync" && rest[1] === "status" ? "sync-status" : command, rest: rest.slice(1), flags };
}
