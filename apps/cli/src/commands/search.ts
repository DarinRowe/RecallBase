import { querySearch } from "@recallbase/core";
import type { ResultEnvelope, SearchResult } from "@recallbase/contracts";
import { refreshBeforeQuery } from "./refresh";
import type { CommandContext } from "./shared";

export interface SearchRequest {
  query: string;
  sourceId?: string;
  date?: string;
  limit?: number;
}

export async function runSearch(context: CommandContext, request: SearchRequest): Promise<ResultEnvelope<SearchResult>> {
  if (request.query.trim()) {
    const flags = request.sourceId === undefined
      ? context.flags
      : { ...context.flags, sourceIds: [request.sourceId] };
    await refreshBeforeQuery({ ...context, flags });
  }
  const options: { sourceId?: string; date?: string; limit?: number } = {};
  if (request.sourceId !== undefined) options.sourceId = request.sourceId;
  if (request.date !== undefined) options.date = request.date;
  if (request.limit !== undefined) options.limit = request.limit;
  return querySearch(context.db, request.query, options);
}

export function searchCommand(context: CommandContext, rest: string[]): Promise<ResultEnvelope<SearchResult>> {
  const request: SearchRequest = { query: rest.join(" ") };
  if (context.flags.sourceIds[0] !== undefined) request.sourceId = context.flags.sourceIds[0];
  if (context.flags.date !== undefined) request.date = context.flags.date;
  if (context.flags.limit !== undefined) request.limit = context.flags.limit;
  return runSearch(context, request);
}
