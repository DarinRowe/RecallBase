import { describe, expect, test } from "bun:test";
import { queryOpen, querySearch, querySources, queryToday } from "../src/query/queries";
import { LocalDatabase } from "../src/store/database";
import { localDayRangeUtc } from "../src/time/local-date";

function seededDb(): LocalDatabase {
  const db = new LocalDatabase();
  db.importBatch({
    sourceId: "claude-code",
    sourceLabel: "Claude Code",
    confidence: "stable",
    confidenceReason: "Fixture matches session JSONL shape.",
    conversations: [
      {
        sourceId: "claude-code",
        sourceLabel: "Claude Code",
        upstreamId: "session-a",
        title: "Importer diagnostics",
        startedAt: "2026-05-21T09:00:00.000Z",
        updatedAt: "2026-05-21T09:30:00.000Z",
        rawEvidence: [],
        messages: [
          {
            role: "user",
            createdAt: "2026-05-21T09:00:00.000Z",
            text: "Malformed records should become visible diagnostics."
          }
        ]
      }
    ]
  });
  return db;
}

describe("queries", () => {
  test("search by content returns stable ids and compact snippets", () => {
    const db = seededDb();
    const result = querySearch(db, "visible diagnostics");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.results[0]).toMatchObject({
        sourceId: "claude-code",
        title: "Importer diagnostics",
        uri: `recallbase:conversation/${result.data.results[0]?.id}`
      });
      expect(result.data.results[0]?.snippet).toContain("visible diagnostics");
    }
  });

  test("today groups same-day sessions and continuation hints", () => {
    const db = seededDb();
    const result = queryToday(db, "2026-05-21");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.keySessions).toHaveLength(1);
      expect(result.data.continuationHints[0]).toStartWith("rb open conv_");
    }
  });

  test("date filters use local-day UTC boundaries", () => {
    const previousTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    const db = new LocalDatabase();
    try {
      db.importBatch({
        sourceId: "codex",
        sourceLabel: "Codex",
        confidence: "stable",
        confidenceReason: "test fixture",
        conversations: [
          {
            sourceId: "codex",
            sourceLabel: "Codex",
            upstreamId: "inside-local-day",
            title: "Inside local day",
            startedAt: "2026-05-21T07:00:00.000Z",
            updatedAt: "2026-05-22T06:59:59.999Z",
            rawEvidence: [],
            messages: [{ role: "user", createdAt: "2026-05-21T07:00:00.000Z", text: "local boundary match" }]
          },
          {
            sourceId: "codex",
            sourceLabel: "Codex",
            upstreamId: "outside-local-day",
            title: "Outside local day",
            startedAt: "2026-05-22T07:00:00.000Z",
            updatedAt: "2026-05-22T07:00:00.000Z",
            rawEvidence: [],
            messages: [{ role: "user", createdAt: "2026-05-22T07:00:00.000Z", text: "local boundary miss" }]
          }
        ]
      });

      expect(localDayRangeUtc("2026-05-21")).toEqual({ start: "2026-05-21T07:00:00.000Z", end: "2026-05-22T07:00:00.000Z" });
      expect(db.today("2026-05-21").map((item) => item.title)).toEqual(["Inside local day"]);
      expect(db.search("local boundary", { date: "2026-05-21" }).map((item) => item.title)).toEqual(["Inside local day"]);
    } finally {
      if (previousTz === undefined) delete process.env.TZ;
      else process.env.TZ = previousTz;
    }
  });

  test("invalid dates are rejected at query boundaries", () => {
    const db = seededDb();

    expect(queryToday(db, "2026-02-31").ok).toBe(false);
    expect(querySearch(db, "diagnostics", { date: "not-a-date" }).ok).toBe(false);
  });

  test("empty database returns valid envelopes", () => {
    const db = new LocalDatabase();
    const today = queryToday(db, "2026-05-21");
    const sources = querySources(db);

    expect(today.ok).toBe(true);
    expect(sources.ok).toBe(true);
  });

  test("open handles not found and valid ids", () => {
    const db = seededDb();
    const id = db.search("diagnostics")[0]!.id;

    expect(queryOpen(db, "missing").ok).toBe(false);
    expect(queryOpen(db, id).ok).toBe(true);
  });
});
