import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDatabase } from "@recallbase/core";
import { runCommand } from "../src/cli";

function seedDb(path: string): void {
  const db = new LocalDatabase(path);
  db.importBatch({
    sourceId: "codex",
    sourceLabel: "Codex",
    confidence: "stable",
    confidenceReason: "test fixture",
    conversations: [
      {
        sourceId: "codex",
        sourceLabel: "Codex",
        upstreamId: "cli-json",
        title: "CLI JSON contract",
        startedAt: "2026-05-21T11:00:00.000Z",
        updatedAt: "2026-05-21T11:05:00.000Z",
        rawEvidence: [],
        messages: [
          { role: "user", createdAt: "2026-05-21T11:00:00.000Z", text: "Before the matching message." },
          { role: "assistant", createdAt: "2026-05-21T11:01:00.000Z", text: "Agent should call rb today --json." },
          { role: "user", createdAt: "2026-05-21T11:02:00.000Z", text: "After the matching message." }
        ]
      }
    ]
  });
  db.close();
}

describe("CLI JSON", () => {
  test("today/search/open/sources return stable envelopes", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "rb-cli-")), "db.sqlite");
    seedDb(path);

    const today = await runCommand(["today", "--json", "--db", path]);
    expect(today.code).toBe(0);
    expect(JSON.parse(today.stdout).ok).toBe(true);

    const search = await runCommand(["search", "today", "--json", "--db", path]);
    const searchBody = JSON.parse(search.stdout);
    expect(searchBody.data.results[0].title).toBe("CLI JSON contract");
    expect(searchBody.data.results[0].uri).toBe(`recallbase:conversation/${searchBody.data.results[0].id}`);

    const opened = await runCommand(["open", searchBody.data.results[0].id, "--json", "--db", path]);
    expect(JSON.parse(opened.stdout).data.messages[1].text).toContain("rb today");

    const windowed = await runCommand([
      "open",
      searchBody.data.results[0].id,
      "--message",
      searchBody.data.results[0].matchedMessageId,
      "--context",
      "0",
      "--json",
      "--db",
      path
    ]);
    expect(JSON.parse(windowed.stdout).data).toMatchObject({
      messageCount: 3,
      messages: [{ text: "Agent should call rb today --json." }],
      messageWindow: { context: 0, returnedMessages: 1 }
    });

    const sources = await runCommand(["sources", "--json", "--db", path]);
    expect(JSON.parse(sources.stdout).data.sources[0].id).toBe("codex");
  });

  test("executable writes large open JSON responses without truncation", () => {
    const path = join(mkdtempSync(join(tmpdir(), "rb-cli-large-json-")), "db.sqlite");
    const db = new LocalDatabase(path);
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      confidence: "stable",
      confidenceReason: "test fixture",
      conversations: [
        {
          sourceId: "codex",
          sourceLabel: "Codex",
          upstreamId: "large-json",
          title: "Large JSON output",
          startedAt: "2026-05-21T11:00:00.000Z",
          updatedAt: "2026-05-21T11:05:00.000Z",
          rawEvidence: [],
          messages: [{ role: "assistant", createdAt: "2026-05-21T11:05:00.000Z", text: "x".repeat(90_000) }]
        }
      ]
    });
    const id = db.search("Large JSON")[0]!.id;
    db.close();

    const result = Bun.spawnSync([
      process.execPath,
      join(import.meta.dir, "../src/cli.ts"),
      "open",
      id,
      "--json",
      "--db",
      path
    ]);
    const stdout = new TextDecoder().decode(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(90_000);
    expect(JSON.parse(stdout).data.messages[0].text).toHaveLength(90_000);
  });
});
