import { mkdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { homedir } from "node:os";
import { ok, type BackupResult, type ResultEnvelope } from "@recallbase/contracts";
import type { CommandContext } from "./shared";

export async function backupCommand(context: CommandContext): Promise<ResultEnvelope<BackupResult>> {
  const exportedAt = new Date().toISOString();
  const path = context.flags.outPath ?? defaultBackupPath(exportedAt);

  await mkdir(dirname(path), { recursive: true });

  const result = extname(path) === ".json"
    ? await context.db.writeBackup(path, exportedAt)
    : await context.db.writeSqliteBackup(path, exportedAt);
  return ok("backup", result);
}

function defaultBackupPath(exportedAt: string): string {
  return join(homedir(), ".recallbase", "backups", `backup-${exportedAt.replace(/[:.]/g, "-")}.sqlite`);
}
