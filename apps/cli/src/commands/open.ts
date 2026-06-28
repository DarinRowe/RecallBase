import { queryOpen } from "@recallbase/core";
import type { CommandContext } from "./shared";

export function openCommand(context: CommandContext, rest: string[]) {
  return queryOpen(context.db, rest[0] ?? "");
}
