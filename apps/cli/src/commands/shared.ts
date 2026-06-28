import { LocalDatabase } from "@recallbase/core";
import type { CliFlags } from "../config";

export interface CommandContext {
  flags: CliFlags;
  db: LocalDatabase;
}

export function parseLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit) || limit <= 0) return 10;
  return Math.min(limit, 50);
}
