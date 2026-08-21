import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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
            text: `Perf response ${index}${index === 4_999 ? " 评分提示" : ""}`,
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
      const searchStarted = performance.now();
      expect(db.search("评分", { sourceId: "claude-web" })).toHaveLength(1);
      expect(performance.now() - searchStarted).toBeLessThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20000);

  test("Kimi Code importer streams a tool-heavy wire without indexing tool payloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-kimi-code-perf-"));
    try {
      const sessionDir = join(dir, "sessions", "wd_perf", "session_perf");
      const wirePath = join(sessionDir, "agents", "main", "wire.jsonl");
      await mkdir(join(sessionDir, "agents", "main"), { recursive: true });
      await writeFile(join(sessionDir, "state.json"), JSON.stringify({
        id: "session_perf",
        title: "Kimi Code performance fixture",
        createdAt: 1782147600000,
        updatedAt: 1782147800000
      }));
      const sink = Bun.file(wirePath).writer();
      sink.write(`${JSON.stringify({
        type: "context.append_message",
        message: { role: "user", content: [{ type: "text", text: "Keep the useful prompt." }], origin: { kind: "user" } },
        time: 1782147601000
      })}\n`);
      const ignoredOutput = `IGNORED_TOOL_PAYLOAD_${"x".repeat(4096)}`;
      for (let index = 0; index < 4_000; index += 1) {
        sink.write(`${JSON.stringify({
          type: "context.append_loop_event",
          event: { type: "tool.result", toolCallId: `tool-${index}`, result: { output: ignoredOutput, isError: false } },
          time: 1782147602000 + index
        })}\n`);
      }
      sink.write(`${JSON.stringify({
        type: "context.append_message",
        message: { role: "assistant", content: [{ type: "text", text: "Keep the useful answer." }] },
        time: 1782147800000
      })}\n`);
      await sink.end();

      const db = new LocalDatabase();
      const started = performance.now();
      const result = await importKnownSources(db, { roots: [dir], sourceIds: ["kimi-code"] });
      const elapsed = performance.now() - started;

      expect((await stat(wirePath)).size).toBeGreaterThan(16 * 1024 * 1024);
      expect(result.totals).toMatchObject({ conversations: 1, messages: 2, rawEvidence: 0 });
      expect(db.search("IGNORED_TOOL_PAYLOAD")).toEqual([]);
      expect(elapsed).toBeLessThan(3000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 10000);
});
