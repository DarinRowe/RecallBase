import { LocalDatabase } from "@recallbase/core";
import type { CliFlags } from "../config";

export interface CommandContext {
  flags: CliFlags;
  db: LocalDatabase;
}
