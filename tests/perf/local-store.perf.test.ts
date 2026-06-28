import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../../packages/core/src/store/database";
import { importKnownSources } from "../../packages/importers/src";

describe("local store perf signal", () => {
  test("search and today stay fast on a fixture-sized corpus", () => {
    const db = new LocalDatabase();
    const conversations = Array.from({ length: 200 }, (_, index) => ({
      sourceId: "codex",
      sourceLabel: "Codex",
      upstreamId: `session-${index}`,
      title: `Session ${index}`,
      startedAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:10:00.000Z",
      rawEvidence: [],
      messages: [
        {
          role: "assistant" as const,
          createdAt: "2026-05-21T10:01:00.000Z",
          text: `RecallBase fixture message ${index} with searchable sync and import content.`
        }
      ]
    }));

    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations,
      confidence: "stable",
      confidenceReason: "Generated perf fixture."
    });

    const started = performance.now();
    expect(db.search("sync import", { limit: 20 })).toHaveLength(20);
    expect(db.today("2026-05-21")).toHaveLength(8);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("Claude web importer handles 5000 exported conversations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-claude-web-perf-"));
    try {
      await writeFile(join(dir, "conversations.json"), JSON.stringify(Array.from({ length: 5000 }, (_, index) => ({
        uuid: `claude-web-perf-${index}`,
        name: `Claude Web Perf ${index}`,
        created_at: "2026-04-06T08:00:00.000000Z",
        updated_at: "2026-04-06T08:01:00.000000Z",
        chat_messages: [
          {
            uuid: `message-user-${index}`,
            sender: "human",
            text: `Perf prompt ${index}`,
            created_at: "2026-04-06T08:00:00.000000Z",
            updated_at: "2026-04-06T08:00:00.000000Z",
            attachments: [],
            files: []
          },
          {
            uuid: `message-assistant-${index}`,
            sender: "assistant",
            text: `Perf response ${index}`,
            created_at: "2026-04-06T08:01:00.000000Z",
            updated_at: "2026-04-06T08:01:00.000000Z",
            attachments: [],
            files: []
          }
        ]
      }))));

      const db = new LocalDatabase();
      const started = performance.now();
      const result = await importKnownSources(db, { roots: [dir], sourceIds: ["claude-web"] });
      const elapsed = performance.now() - started;

      expect(result.totals).toMatchObject({ conversations: 5000, messages: 10000, rawEvidence: 0 });
      expect(db.sources()[0]).toMatchObject({ id: "claude-web", conversations: 5000, messages: 10000, rawEvidence: 0 });
      expect(elapsed).toBeLessThan(15000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20000);
});
