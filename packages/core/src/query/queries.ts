import { err, ok, type ResultEnvelope, type SearchResult, type SourcesResult, type TodayResult } from "@recallbase/contracts";
import type { LocalDatabase } from "../store/database";
import { isLocalDateString, localDateString } from "../time/local-date";

export function queryToday(db: LocalDatabase, date = localDateString()): ResultEnvelope<TodayResult> {
  if (!isLocalDateString(date)) {
    return err("today", {
      code: "invalid_arguments",
      message: "Date must be a valid YYYY-MM-DD local date.",
      hint: "Try rb today --date 2026-05-22."
    });
  }

  const keySessions = db.today(date);
  const sources = db.sources();
  return ok("today", {
    date,
    summary:
      keySessions.length === 0
        ? "No imported sessions for this date."
        : `${keySessions.length} session${keySessions.length === 1 ? "" : "s"} touched this date.`,
    keySessions,
    continuationHints: keySessions.slice(0, 3).map((session) => `rb open ${session.id}`),
    sourceCoverage: sources
  });
}

export function querySearch(
  db: LocalDatabase,
  query: string,
  options: { sourceId?: string; date?: string; limit?: number } = {}
): ResultEnvelope<SearchResult> {
  if (!query.trim()) {
    return err("search", {
      code: "invalid_arguments",
      message: "Search query is required.",
      hint: "Try rb search \"your terms\"."
    });
  }
  if (options.date !== undefined && !isLocalDateString(options.date)) {
    return err("search", {
      code: "invalid_arguments",
      message: "Date must be a valid YYYY-MM-DD local date.",
      hint: "Try rb search \"your terms\" --date 2026-05-22."
    });
  }

  const filters: SearchResult["filters"] = { limit: options.limit ?? 10 };
  if (options.sourceId !== undefined) filters.sourceId = options.sourceId;
  if (options.date !== undefined) filters.date = options.date;

  return ok("search", {
    query,
    filters,
    results: db.search(query, options),
    sourceCoverage: db.sources()
  });
}

export function queryOpen(db: LocalDatabase, id: string) {
  if (!id.trim()) {
    return err("open", {
      code: "invalid_arguments",
      message: "Conversation id is required.",
      hint: "Run rb search first, then rb open <id>."
    });
  }

  const conversation = db.open(id);
  if (conversation === "ambiguous") {
    return err("open", {
      code: "ambiguous_id",
      message: "Conversation id prefix matches multiple records.",
      hint: "Use the full id from rb search --json."
    });
  }
  if (!conversation) {
    return err("open", {
      code: "not_found",
      message: "Conversation was not found.",
      hint: "Run rb search --json to find a current id."
    });
  }
  return ok("open", conversation);
}

export function querySources(db: LocalDatabase): ResultEnvelope<SourcesResult> {
  return ok("sources", { sources: db.sources() });
}
