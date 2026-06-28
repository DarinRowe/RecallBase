import { describe, expect, test } from "bun:test";
import { LocalDatabase, queryOpen, querySearch, querySources, queryToday } from "../../packages/core/src";
import { callTool } from "../../apps/cli/src/mcp/tools";
import { syncStatusCommand } from "../../apps/cli/src/commands/sync";

describe("MCP parity", () => {
  test("search returns the same ids as CLI JSON query layer", async () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "claude-code",
      sourceLabel: "Claude Code",
      confidence: "stable",
      confidenceReason: "fixture",
      conversations: [
        {
          sourceId: "claude-code",
          sourceLabel: "Claude Code",
          title: "Parity test",
          startedAt: "2026-05-21T13:00:00.000Z",
          updatedAt: "2026-05-21T13:00:00.000Z",
          rawEvidence: [],
          messages: [{ role: "user", createdAt: "2026-05-21T13:00:00.000Z", text: "Search parity matters." }]
        }
      ]
    });

    const cli = querySearch(db, "parity");
    const mcp = await callTool(db, { name: "search", arguments: { query: "parity" } }, { json: true, dbPath: ":memory:", roots: [], sourceIds: [] });

    expect(cli.ok).toBe(true);
    expect(mcp.ok).toBe(true);
    if (cli.ok && mcp.ok && mcp.meta.command === "search") {
      expect(mcp.data.results[0]?.id).toBe(cli.data.results[0]?.id);
    }
  });

  test("today, open, sources, and sync_status mirror query-layer envelopes", async () => {
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
          title: "MCP full parity",
          startedAt: "2026-05-21T13:00:00.000Z",
          updatedAt: "2026-05-21T13:00:00.000Z",
          rawEvidence: [],
          messages: [{ role: "assistant", createdAt: "2026-05-21T13:00:00.000Z", text: "Open me through MCP." }]
        }
      ]
    });
    const flags = { json: true, dbPath: ":memory:", roots: [], sourceIds: [], authPath: "" };
    const id = db.today("2026-05-21")[0]!.id;

    expect(stripGeneratedAt(await callTool(db, { name: "today", arguments: { date: "2026-05-21" } }, flags))).toEqual(stripGeneratedAt(queryToday(db, "2026-05-21")));
    expect(stripGeneratedAt(await callTool(db, { name: "open", arguments: { id } }, flags))).toEqual(stripGeneratedAt(queryOpen(db, id)));
    expect(stripGeneratedAt(await callTool(db, { name: "sources", arguments: {} }, flags))).toEqual(stripGeneratedAt(querySources(db)));
    expect(stripGeneratedAt(await callTool(db, { name: "sync_status", arguments: {} }, flags))).toEqual(stripGeneratedAt(await syncStatusCommand({ db, flags })));
    expect(await callTool(db, { name: "missing", arguments: {} }, flags)).toMatchObject({
      ok: false,
      error: { code: "invalid_arguments" }
    });
  });
});

function stripGeneratedAt<T extends { meta: { generatedAt: string } }>(envelope: T): Omit<T, "meta"> & { meta: Omit<T["meta"], "generatedAt"> } {
  const { generatedAt, ...meta } = envelope.meta;
  return { ...envelope, meta };
}
