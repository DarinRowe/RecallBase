#!/usr/bin/env bun
import { basename, win32 } from "node:path";
import { err, type ResultEnvelope } from "@recallbase/contracts";
import { LocalDatabase } from "@recallbase/core";
import { parseFlags } from "./config";
import { backupCommand } from "./commands/backup";
import { importCommand } from "./commands/import";
import { openCommand } from "./commands/open";
import { searchCommand } from "./commands/search";
import { sourcesCommand } from "./commands/sources";
import { todayCommand } from "./commands/today";
import { extensionHostCommand } from "./commands/extension-host";
import { extensionInstallCommand } from "./commands/extension-install";
import { refreshBeforeQuery } from "./commands/refresh";
import { formatHuman } from "./output/human";
import { formatJson } from "./output/json";
import { runMcpServer } from "./mcp/server";
import packageJson from "../../../package.json";

export interface RunResult {
  code: number;
  stdout: string;
}

export function defaultArgv(argv = Bun.argv, executablePath = process.execPath): string[] {
  if (isExtensionHostExecutable(executablePath)
    || isExtensionHostExecutable(argv[1])
    || isExtensionHostExecutable(argv[0])) {
    return ["extension-host", ...argv.slice(2)];
  }
  return argv.slice(2);
}

export function isCliEntrypoint(importMetaMain: boolean, importMetaPath: string): boolean {
  if (importMetaMain) return true;
  const normalized = importMetaPath.replaceAll("\\", "/");
  return normalized.includes("/$bunfs/") || /^[a-z]:\/~bun\//i.test(normalized);
}

export async function runCommand(argv = defaultArgv(), env: NodeJS.ProcessEnv = process.env): Promise<RunResult> {
  const { command, rest, flags } = parseFlags(argv, env);
  if (command === "help" || command === "--help" || command === "-h") {
    return { code: 0, stdout: commandHelp() };
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    return { code: 0, stdout: commandHelp(command) };
  }
  if (command === "version" || command === "--version" || command === "-V") {
    return { code: 0, stdout: `recallbase ${packageJson.version}\n` };
  }
  if (command === "extension" && (rest[0] === "install-host" || rest[0] === "verify-host")) {
    const result = await extensionInstallCommand(undefined, rest, {
      env,
      chromiumUserDataDirs: flags.chromiumUserDataDirs,
      chromiumRegistryRoots: flags.chromiumRegistryRoots,
      clearChromiumTargets: flags.clearChromiumTargets
    });
    return {
      code: result.ok ? 0 : 1,
      stdout: flags.json ? formatJson(result) : formatHuman(result)
    };
  }

  const db = new LocalDatabase(flags.dbPath);
  try {
    if (command === "mcp") {
      await runMcpServer(db, flags);
      return { code: 0, stdout: "" };
    }
    if (command === "extension-host") {
      await extensionHostCommand({ flags, db });
      return { code: 0, stdout: "" };
    }

    const result = await dispatch(command, rest, { flags, db });
    return {
      code: result.ok ? 0 : 1,
      stdout: flags.json ? formatJson(result) : formatHuman(result)
    };
  } finally {
    db.close();
  }
}

export async function main(argv = defaultArgv()): Promise<number> {
  const result = await runCommand(argv);
  await Bun.write(Bun.stdout, result.stdout);
  return result.code;
}

function isExtensionHostExecutable(path: string | undefined): boolean {
  if (!path) return false;
  return /^extension-host(?:\.exe)?$/i.test(basename(path)) || /^extension-host(?:\.exe)?$/i.test(win32.basename(path));
}

async function dispatch(command: string, rest: string[], context: Parameters<typeof todayCommand>[0]): Promise<ResultEnvelope<unknown>> {
  if (command === "import") return importCommand(context);
  if (command === "today") {
    await refreshBeforeQuery(context);
    return todayCommand(context);
  }
  if (command === "search") return searchCommand(context, rest);
  if (command === "open") return openCommand(context, rest);
  if (command === "sources") return sourcesCommand(context);
  if (command === "backup") return backupCommand(context);
  return err("unknown", {
    code: "invalid_arguments",
    message: `Unknown command '${command}'.`,
    hint: "Run rb --help.",
    details: { attemptedCommand: command }
  });
}

function commandHelp(command?: string): string {
  const usage: Record<string, string> = {
    import: "rb import [--source <source-id>] [--root <path>] [--force] [--json]",
    today: "rb today [--date YYYY-MM-DD] [--json]",
    search: "rb search <query> [--source <source-id>] [--date YYYY-MM-DD] [--limit 1-50] [--json]",
    open: "rb open <conversation-id> [--message <message-id> [--context 0-5]] [--json]",
    sources: "rb sources [--json]",
    backup: "rb backup [--out <path>] [--json]",
    extension: "rb extension <install-host|verify-host> [--chromium-user-data-dir <path>] [--chromium-registry-root <HKCU-key>] [--clear-chromium-targets] [--json]",
    "extension-host": "rb extension-host",
    mcp: "rb mcp",
    version: "rb version"
  };
  if (command && usage[command]) return `Usage: ${usage[command]}\n`;
  return "RecallBase commands: import, today, search, open, sources, backup, extension, extension-host, mcp, version\nRun rb <command> --help for usage.\n";
}

if (isCliEntrypoint(import.meta.main, import.meta.path)) {
  process.exit(await main());
}
