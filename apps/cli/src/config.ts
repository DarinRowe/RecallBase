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
  messageId?: string;
  context?: number;
  roots: string[];
  sourceIds: string[];
  chromiumUserDataDirs: string[];
  chromiumRegistryRoots: string[];
  clearChromiumTargets: boolean;
  outPath?: string;
}

export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.RECALLBASE_DB ?? join(homedir(), ".recallbase", "recallbase.sqlite");
}

export function parseFlags(args: string[], env: NodeJS.ProcessEnv = process.env): { command: string; rest: string[]; flags: CliFlags } {
  const rest: string[] = [];
  const roots: string[] = [];
  const sourceIds: string[] = [];
  const chromiumUserDataDirs: string[] = [];
  const chromiumRegistryRoots: string[] = [];
  const flags: CliFlags = {
    json: false,
    force: false,
    noRefresh: false,
    dbPath: defaultDbPath(env),
    dbPathExplicit: false,
    roots,
    sourceIds,
    chromiumUserDataDirs,
    chromiumRegistryRoots,
    clearChromiumTargets: false
  };

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
    } else if (arg === "--message" && next) {
      flags.messageId = next;
      index += 1;
    } else if (arg === "--context" && next) {
      flags.context = Number.parseInt(next, 10);
      index += 1;
    } else if ((arg === "--source-root" || arg === "--root") && next) {
      roots.push(next);
      index += 1;
    } else if (arg === "--source" && next) {
      sourceIds.push(next);
      index += 1;
    } else if (arg === "--chromium-user-data-dir" && next) {
      chromiumUserDataDirs.push(next);
      index += 1;
    } else if (arg === "--chromium-registry-root" && next) {
      chromiumRegistryRoots.push(next);
      index += 1;
    } else if (arg === "--clear-chromium-targets") {
      flags.clearChromiumTargets = true;
    } else if ((arg === "--out" || arg === "-o") && next) {
      flags.outPath = next;
      index += 1;
    } else {
      rest.push(arg);
    }
  }

  const command = rest[0] ?? "help";
  return { command, rest: rest.slice(1), flags };
}
