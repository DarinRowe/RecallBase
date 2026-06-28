import { querySearch } from "@recallbase/core";
import type { ResultEnvelope, SearchResult } from "@recallbase/contracts";
import type { CommandContext } from "./shared";
import { parseLimit } from "./shared";

export function searchCommand(context: CommandContext, rest: string[]): ResultEnvelope<SearchResult> {
  const options: { sourceId?: string; date?: string; limit?: number } = {
    limit: parseLimit(context.flags.limit)
  };
  if (context.flags.date !== undefined) options.date = context.flags.date;
  if (context.flags.sourceIds[0] !== undefined) options.sourceId = context.flags.sourceIds[0];
  return querySearch(context.db, rest.join(" "), options);
}
