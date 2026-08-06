import { describe, expect, test } from "bun:test";
import { LocalDatabase } from "@recallbase/core";
import packageJson from "../../../package.json";
import { callTool } from "../src/mcp/tools";
import { handleRequest } from "../src/mcp/server";

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
    }
  });

  test("implements MCP initialize, tools/list, and tools/call contracts", async () => {
    const db = new LocalDatabase();
    const initialized = await handleRequest(db, flags, { id: 1, method: "initialize" });
    const listed = await handleRequest(db, flags, { id: 2, method: "tools/list" });
    const called = await handleRequest(db, flags, {
      id: 3,
      method: "tools/call",
      params: { name: "sources", arguments: {} }
    });

    expect(initialized.result.capabilities.tools).toEqual({});
    expect(initialized.result.serverInfo).toEqual({ name: "recallbase", version: packageJson.version });
    expect(listed.result.tools[0].inputSchema).toBeDefined();
    expect(JSON.parse(called.result.content[0].text).ok).toBe(true);
  });
});
