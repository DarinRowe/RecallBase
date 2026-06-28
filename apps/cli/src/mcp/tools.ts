import { queryOpen, querySearch, querySources, queryToday, type LocalDatabase } from "@recallbase/core";
import { refreshBeforeQuery } from "../commands/refresh";
import type { CliFlags } from "../config";

export interface McpToolCall {
  name: string;
  arguments?: Record<string, unknown>;
}

export async function callTool(db: LocalDatabase, call: McpToolCall, flags: CliFlags) {
  if (call.name === "today") {
    await refreshBeforeQuery({ db, flags });
    return queryToday(db, call.arguments?.date === undefined ? undefined : String(call.arguments.date));
  }
  if (call.name === "search") {
    const query = String(call.arguments?.query ?? "");
    if (!query.trim()) return querySearch(db, query);
    const sourceId = call.arguments?.sourceId === undefined ? undefined : String(call.arguments.sourceId);
    await refreshBeforeQuery({ db, flags: sourceId === undefined ? flags : { ...flags, sourceIds: [sourceId] } });
    const options: { sourceId?: string; date?: string; limit?: number } = {};
    if (sourceId !== undefined) options.sourceId = sourceId;
    if (call.arguments?.date) options.date = String(call.arguments.date);
    if (call.arguments?.limit) options.limit = Number(call.arguments.limit);
    return querySearch(db, query, options);
  }
  if (call.name === "open") return queryOpen(db, String(call.arguments?.id ?? ""));
  if (call.name === "sources") return querySources(db);
  return {
    ok: false,
    meta: { command: "mcp" as const, generatedAt: new Date().toISOString(), schemaVersion: 1 as const, warnings: [] },
    error: { code: "invalid_arguments" as const, message: `Unknown MCP tool '${call.name}'.` }
  };
}

export const mcpTools = [
  {
    name: "today",
    description: "Return today's RecallBase summary.",
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "YYYY-MM-DD date scope." } },
      additionalProperties: false
    }
  },
  {
    name: "search",
    description: "Search local RecallBase history.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        sourceId: { type: "string" },
        date: { type: "string" },
        limit: { type: "number" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "open",
    description: "Open a local RecallBase conversation by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "sources",
    description: "Return source health and diagnostics.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }
];
