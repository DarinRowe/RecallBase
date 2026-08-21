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

  test("centers snippets on the window matching the most query terms", () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      confidence: "stable",
      confidenceReason: "test fixture",
      conversations: [{
        sourceId: "codex",
        sourceLabel: "Codex",
        upstreamId: "best-snippet",
        title: "Search excerpt",
        startedAt: "2026-05-21T09:00:00.000Z",
        updatedAt: "2026-05-21T09:30:00.000Z",
        rawEvidence: [],
        messages: [{
          role: "assistant",
          createdAt: "2026-05-21T09:00:00.000Z",
          text: `SEO ${"unrelated ".repeat(35)}The strongest SEO 建议 is to publish original research.`
        }]
      }]
    });

    expect(db.search("SEO 建议")[0]?.snippet).toContain("strongest SEO 建议");
  });

  test("normalizes search limits consistently for direct and envelope queries", () => {
    const db = seededDb();

    expect(db.search("diagnostics", { limit: -1 })).toHaveLength(1);
    expect(querySearch(db, "diagnostics", { limit: 0.5 })).toMatchObject({
      ok: true,
      data: { filters: { limit: 10 } }
    });
    const capped = querySearch(db, "diagnostics", { limit: 500 });
    expect(capped.ok).toBe(true);
    if (capped.ok) expect(capped.data.filters.limit).toBe(50);
  });

  test("searches Unicode scripts without language-specific dependencies", () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "kimi-code",
      sourceLabel: "Kimi Code",
      confidence: "stable",
      confidenceReason: "test fixture",
      conversations: [
        {
          sourceId: "kimi-code",
          sourceLabel: "Kimi Code",
          upstreamId: "multilingual-search",
          title: "Worldwide search",
          startedAt: "2026-05-21T09:00:00.000Z",
          updatedAt: "2026-05-21T09:30:00.000Z",
          rawEvidence: [],
          messages: [
            {
              role: "assistant",
              createdAt: "2026-05-21T09:00:00.000Z",
              text: "评分提示应该在成功导出后出现。評価コメントを確認。한국어 검색. ความคิดเห็นคะแนน. تقييم التعليقات. Привет мир. café résumé. उपयोगकर्ता इतिहास. RecallBase"
            }
          ]
        }
      ]
    });

    for (const query of [
      "评分提示",
      "评分",
      "評価コメント",
      "한국어",
      "ความคิดเห็น",
      "تقييم",
      "Привет",
      "cafe",
      "उपयोगकर्ता",
      "ＲｅｃａｌｌＢａｓｅ"
    ]) {
      expect(db.search(query), query).toHaveLength(1);
    }
    expect(db.search("评分", { sourceId: "codex" })).toEqual([]);
    expect(db.search("评分", { date: "2026-05-22" })).toEqual([]);
  });

  test("source-filtered search returns only matching source coverage", () => {
    const db = seededDb();
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      confidence: "stable",
      confidenceReason: "test fixture",
      conversations: [],
      diagnostics: []
    });

    const result = querySearch(db, "diagnostics", { sourceId: "claude-code" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.sourceCoverage.map((source) => source.id)).toEqual(["claude-code"]);
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

  test("opens a bounded message window around a search match", () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      confidence: "stable",
      confidenceReason: "test fixture",
      conversations: [{
        sourceId: "codex",
        sourceLabel: "Codex",
        upstreamId: "message-window",
        title: "Bounded evidence",
        startedAt: "2026-05-21T09:00:00.000Z",
        updatedAt: "2026-05-21T09:04:00.000Z",
        rawEvidence: [],
        messages: ["before one", "before two", "matched evidence", "after one", "after two"].map((text, index) => ({
          role: index % 2 === 0 ? "user" as const : "assistant" as const,
          createdAt: `2026-05-21T09:0${index}:00.000Z`,
          text
        }))
      }]
    });
    const match = db.search("matched evidence")[0]!;
    const opened = queryOpen(db, match.id, { messageId: match.matchedMessageId, context: 1 });

    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.data.messageCount).toBe(5);
      expect(opened.data.messages.map((message) => message.text)).toEqual(["before two", "matched evidence", "after one"]);
      expect(opened.data.messageWindow).toEqual({
        anchorMessageId: match.matchedMessageId,
        context: 1,
        returnedMessages: 3
      });
    }
    expect(queryOpen(db, match.id, { messageId: "missing", context: 1 })).toMatchObject({
      ok: false,
      error: { code: "not_found" }
    });
    expect(queryOpen(db, match.id, { context: 1 })).toMatchObject({
      ok: false,
      error: { code: "invalid_arguments" }
    });
  });
});
