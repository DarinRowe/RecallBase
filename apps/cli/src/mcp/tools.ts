import { queryOpen, querySources, queryToday, type LocalDatabase, type OpenConversationOptions } from "@recallbase/core";
import { refreshBeforeQuery } from "../commands/refresh";
import { runSearch, type SearchRequest } from "../commands/search";
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
    const sourceId = call.arguments?.sourceId === undefined ? undefined : String(call.arguments.sourceId);
    const request: SearchRequest = { query };
    if (sourceId !== undefined) request.sourceId = sourceId;
    if (call.arguments?.date !== undefined) request.date = String(call.arguments.date);
    if (call.arguments?.limit !== undefined) request.limit = Number(call.arguments.limit);
    return runSearch({ db, flags }, request);
  }
  if (call.name === "open") {
    const options: OpenConversationOptions = {};
    if (call.arguments?.messageId !== undefined) options.messageId = String(call.arguments.messageId);
    if (call.arguments?.context !== undefined) options.context = Number(call.arguments.context);
    return queryOpen(db, String(call.arguments?.id ?? ""), options);
  }
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
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "open",
    description: "Open a local RecallBase conversation, optionally around a matched message.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        messageId: { type: "string", description: "Matched message id returned by search." },
        context: { type: "integer", minimum: 0, maximum: 5, description: "Neighboring messages on each side; defaults to 1." }
      },
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
