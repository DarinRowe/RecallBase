import { describe, expect, test } from "bun:test";
import { LocalDatabase } from "@recallbase/core";
import packageJson from "../../../package.json";
import { callTool } from "../src/mcp/tools";
import { handleRequest, runMcpStream } from "../src/mcp/server";

const flags = { json: true, dbPath: ":memory:", roots: [], sourceIds: [] };

describe("MCP tools", () => {
  test("mirrors local query semantics", async () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      confidence: "stable",
      confidenceReason: "fixture",
      conversations: [
        {
          sourceId: "codex",
          sourceLabel: "Codex",
          title: "MCP parity",
          startedAt: "2026-05-21T12:00:00.000Z",
          updatedAt: "2026-05-21T12:00:00.000Z",
          rawEvidence: [],
          messages: [{ role: "assistant", createdAt: "2026-05-21T12:00:00.000Z", text: "MCP reads CLI contracts." }]
        }
      ]
    });

    const search = await callTool(db, { name: "search", arguments: { query: "contracts" } }, flags);
    expect(search.ok).toBe(true);
    if (search.ok && search.meta.command === "search") {
      expect(search.data.results[0]?.title).toBe("MCP parity");
      expect(search.data.results[0]?.uri).toBe(`recallbase:conversation/${search.data.results[0]?.id}`);
    }
  });

  test("implements MCP initialize, tools/list, and tools/call contracts", async () => {
    const db = new LocalDatabase();
    const initialized = await handleRequest(db, flags, { jsonrpc: "2.0", id: 1, method: "initialize" });
    const listed = await handleRequest(db, flags, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const called = await handleRequest(db, flags, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "sources", arguments: {} }
    });

    expect(initialized).toBeDefined();
    expect(listed).toBeDefined();
    expect(called).toBeDefined();
    if (!initialized || !listed || !called) throw new Error("Expected MCP responses.");
    expect(initialized.result.capabilities.tools).toEqual({});
    expect(initialized.result.serverInfo).toEqual({ name: "recallbase", version: packageJson.version });
    expect(listed.result.tools[0].inputSchema).toBeDefined();
    expect(JSON.parse(called.result.content[0].text).ok).toBe(true);
    expect(called.result.isError).toBe(false);
  });

  test("buffers fragmented lines, reports parse errors, and continues serving", async () => {
    const db = new LocalDatabase();
    const output: string[] = [];

    async function* chunks() {
      yield '{"jsonrpc":"2.0","id":1,"method":"tools/';
      yield 'list"}\nnot-json\n';
      yield '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sources","arguments":{}}}\n';
    }

    await runMcpStream(db, flags, chunks(), (line) => output.push(line));
    const responses = output.map((line) => JSON.parse(line));

    expect(responses).toHaveLength(3);
    expect(responses[0].result.tools).toHaveLength(4);
    expect(responses[1].error.code).toBe(-32700);
    expect(JSON.parse(responses[2].result.content[0].text).ok).toBe(true);
  });

  test("does not answer notifications and marks query failures as tool errors", async () => {
    const db = new LocalDatabase();
    const notification = await handleRequest(db, flags, {
      jsonrpc: "2.0",
      method: "notifications/initialized"
    });
    const missingQuery = await handleRequest(db, flags, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "search", arguments: {} }
    });
    const missingConversation = await handleRequest(db, flags, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "open", arguments: { id: "missing" } }
    });

    expect(notification).toBeUndefined();
    expect(missingQuery?.result.isError).toBe(true);
    expect(JSON.parse(missingQuery?.result.content[0].text).error.code).toBe("invalid_arguments");
    expect(missingConversation?.result.isError).toBe(true);
    expect(JSON.parse(missingConversation?.result.content[0].text).error.code).toBe("not_found");
  });
});
