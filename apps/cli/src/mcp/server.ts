import type { LocalDatabase } from "@recallbase/core";
import packageJson from "../../../../package.json";
import type { CliFlags } from "../config";
import { callTool, mcpTools } from "./tools";

type JsonRpcId = string | number | null;

export interface McpRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

export async function runMcpServer(db: LocalDatabase, flags: CliFlags): Promise<void> {
  process.stdin.setEncoding("utf8");
  await runMcpStream(db, flags, process.stdin, (line) => process.stdout.write(line));
}

export async function runMcpStream(
  db: LocalDatabase,
  flags: CliFlags,
  input: AsyncIterable<string | Uint8Array>,
  write: (line: string) => unknown
): Promise<void> {
  let buffer = "";
  const decoder = new TextDecoder();

  for await (const chunk of input) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      await processLine(buffer.slice(0, newlineIndex), db, flags, write);
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) await processLine(buffer, db, flags, write);
}

export async function handleRequest(
  db: LocalDatabase,
  flags: CliFlags,
  request: McpRequest
) {
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return jsonRpcError(request.id ?? null, -32600, "Invalid Request: expected JSON-RPC 2.0 with a method.");
  }
  if (request.id === undefined) return undefined;

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
  if (request.method === "tools/call") {
    const name = String(request.params?.name ?? "");
    const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
    const result = await callTool(db, { name, arguments: args }, flags);
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: !result.ok
      }
    };
  }
  return jsonRpcError(request.id, -32601, `Unknown method '${request.method}'.`);
}

async function processLine(
  line: string,
  db: LocalDatabase,
  flags: CliFlags,
  write: (line: string) => unknown
) {
  if (!line.trim()) return;

  let request: McpRequest;
  try {
    request = JSON.parse(line) as McpRequest;
  } catch {
    write(`${JSON.stringify(jsonRpcError(null, -32700, "Parse error: input must be one JSON object per line."))}\n`);
    return;
  }

  if (!request || typeof request !== "object" || Array.isArray(request)) {
    write(`${JSON.stringify(jsonRpcError(null, -32600, "Invalid Request: expected a JSON-RPC object."))}\n`);
    return;
  }

  const response = await handleRequest(db, flags, request);
  if (response !== undefined) write(`${JSON.stringify(response)}\n`);
}

function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}
