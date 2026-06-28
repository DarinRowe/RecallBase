import { queryToday } from "@recallbase/core";
import type { ResultEnvelope, TodayResult } from "@recallbase/contracts";
import type { CommandContext } from "./shared";

export function todayCommand(context: CommandContext): ResultEnvelope<TodayResult> {
  return queryToday(context.db, context.flags.date);
}
