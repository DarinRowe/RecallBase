import type { LocalDatabase } from "@recallbase/core";
import packageJson from "../../../../package.json";
import type { CliFlags } from "../config";
import { callTool, mcpTools } from "./tools";

export async function runMcpServer(db: LocalDatabase, flags: CliFlags): Promise<void> {
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    for (const line of String(chunk).split("\n")) {
      if (!line.trim()) continue;
      const request = JSON.parse(line) as { id?: string | number; method: string; params?: Record<string, unknown> };
      const response = await handleRequest(db, flags, request);
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
}

export async function handleRequest(
  db: LocalDatabase,
  flags: CliFlags,
  request: { id?: string | number; method: string; params?: Record<string, unknown> }
) {
  if (request.method === "tools/list") {
    return { jsonrpc: "2.0", id: request.id, result: { tools: mcpTools } };
  }
  if (request.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "recallbase", version: packageJson.version }
      }
    };
  }
  if (request.method === "notifications/initialized") {
    return { jsonrpc: "2.0", id: request.id, result: {} };
  }
  if (request.method === "tools/call") {
    const name = String(request.params?.name ?? "");
    const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
    const result = await callTool(db, { name, arguments: args }, flags);
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result) }]
      }
    };
  }
  return {
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -32601, message: `Unknown method '${request.method}'.` }
  };
}
