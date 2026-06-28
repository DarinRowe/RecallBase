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
        messages: [{ role: "user", createdAt: "2026-05-21T11:00:00.000Z", text: "Agent should call rb today --json." }]
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

    const opened = await runCommand(["open", searchBody.data.results[0].id, "--json", "--db", path]);
    expect(JSON.parse(opened.stdout).data.messages[0].text).toContain("rb today");

    const sources = await runCommand(["sources", "--json", "--db", path]);
    expect(JSON.parse(sources.stdout).data.sources[0].id).toBe("codex");
  });
});
