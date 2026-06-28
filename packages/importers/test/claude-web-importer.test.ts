import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDatabase } from "@recallbase/core";
import { importKnownSources } from "../src";
import { createClaudeWebImporter } from "../src/claude-web/importer";

const fixtureRoot = resolve(import.meta.dir, "../../../tests/fixtures/importers/claude-web");

describe("Claude web importer", () => {
  test("auto-detects export directories and imports visible conversation messages", async () => {
    const importer = createClaudeWebImporter();
    const discovery = await importer.discover({ roots: [fixtureRoot] });
    const batch = await importer.importFromPaths(discovery.paths, { discovery });

    expect(discovery.present).toBe(true);
    expect(discovery.paths.map((path) => path.endsWith("conversations.json"))).toEqual([true]);
    expect(batch.conversations).toHaveLength(2);
    expect(batch.diagnostics?.some((item) => item.code === "claude_web_no_messages")).toBe(true);

    const conversation = batch.conversations.find((item) => item.upstreamId === "claude-web-conversation-1")!;
    expect(conversation.sourceId).toBe("claude-web");
    expect(conversation.title).toBe("RecallBase web export import");
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(conversation.messages[1]?.text).toContain("auto-detect conversations.json");
    expect(conversation.messages[1]?.text).not.toContain("Internal chain of thought");
    expect(conversation.rawEvidence).toEqual([]);
    expect(conversation.messages.some((message) => message.rawEvidenceUri)).toBe(false);
    expect(conversation.metadata?.fixtureProvenance).toBe("tests/fixtures/importers/claude-web");

    const unsorted = batch.conversations.find((item) => item.upstreamId === "claude-web-conversation-unsorted")!;
    expect(unsorted.startedAt).toBe("2026-04-06T09:00:00.000Z");
    expect(unsorted.updatedAt).toBe("2026-04-06T09:10:00.000Z");

    const db = new LocalDatabase();
    db.importBatch(batch);
    expect(db.search("visible messages")[0]).toMatchObject({ sourceId: "claude-web" });
    expect(db.search("chain of thought")).toHaveLength(0);
    expect(db.sources()[0]).toMatchObject({ id: "claude-web", confidence: "experimental", health: "healthy" });
  });

  test("detects empty Claude web exports without sender or summary fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-claude-web-empty-"));
    try {
      await writeFile(join(dir, "conversations.json"), JSON.stringify([
        {
          uuid: "empty-no-summary",
          name: "Empty no summary",
          created_at: "2026-04-06T08:00:00.000000Z",
          chat_messages: []
        }
      ]));

      const importer = createClaudeWebImporter();
      const discovery = await importer.discover({ roots: [dir] });
      const batch = await importer.importFromPaths(discovery.paths, { discovery });

      expect(discovery.present).toBe(true);
      expect(discovery.paths).toHaveLength(1);
      expect(batch.conversations).toEqual([]);
      expect(batch.diagnostics?.some((item) => item.code === "claude_web_no_messages")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("streams large exports in bounded conversation batches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-claude-web-stream-"));
    try {
      await writeClaudeWebExport(dir, 205);
      const importer = createClaudeWebImporter();
      const discovery = await importer.discover({ roots: [dir] });
      const batches = [];

      for await (const batch of importer.importBatchesFromPaths!(discovery.paths, { discovery })) {
        batches.push(batch);
      }

      expect(batches.map((batch) => batch.conversations.length)).toEqual([100, 100, 5]);
      expect(batches.reduce((sum, batch) => sum + batch.conversations.length, 0)).toBe(205);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports malformed exports without marking the source healthy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-claude-web-bad-"));
    try {
      await writeFile(join(dir, "conversations.json"), `[${JSON.stringify(conversationFixture(1))}`);
      const db = new LocalDatabase();
      const result = await importKnownSources(db, { roots: [dir], sourceIds: ["claude-web"] });

      expect(result.sources[0]?.source.id).toBe("claude-web");
      expect(result.sources[0]?.source.health).toBe("partial");
      expect(result.sources[0]?.source.diagnostics.some((item) => item.code === "source_unreadable")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function writeClaudeWebExport(dir: string, count: number): Promise<void> {
  await writeFile(join(dir, "conversations.json"), JSON.stringify(Array.from({ length: count }, (_, index) => conversationFixture(index))));
}

function conversationFixture(index: number): Record<string, unknown> {
  return {
    uuid: `claude-web-stream-${index}`,
    name: `Streamed conversation ${index}`,
    created_at: "2026-04-06T08:00:00.000000Z",
    updated_at: "2026-04-06T08:01:00.000000Z",
    chat_messages: [
      {
        uuid: `message-user-${index}`,
        sender: "human",
        text: `Streamed prompt ${index}`,
        created_at: "2026-04-06T08:00:00.000000Z",
        updated_at: "2026-04-06T08:00:00.000000Z",
        attachments: [],
        files: []
      },
      {
        uuid: `message-assistant-${index}`,
        sender: "assistant",
        text: `Streamed response ${index}`,
        created_at: "2026-04-06T08:01:00.000000Z",
        updated_at: "2026-04-06T08:01:00.000000Z",
        attachments: [],
        files: []
      }
    ]
  };
}
