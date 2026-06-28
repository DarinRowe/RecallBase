import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDatabase } from "../src/store/database";

const conversation = {
  sourceId: "codex",
  sourceLabel: "Codex",
  upstreamId: "session-1",
  title: "RecallBase sync planning",
  startedAt: "2026-05-21T08:00:00.000Z",
  updatedAt: "2026-05-21T08:20:00.000Z",
  rawEvidence: [
    {
      sourceId: "codex",
      uri: "file:///codex/session-1.jsonl#L1",
      content: "{\"type\":\"message\",\"payload\":{\"text\":\"ship sync\"}}"
    }
  ],
  messages: [
    {
      upstreamId: "m1",
      role: "user" as const,
      createdAt: "2026-05-21T08:00:00.000Z",
      text: "We need to ship RecallBase sync.",
      rawEvidenceUri: "file:///codex/session-1.jsonl#L1"
    },
    {
      upstreamId: "m2",
      role: "assistant" as const,
      createdAt: "2026-05-21T08:01:00.000Z",
      text: "Implement batch sync with encrypted raw evidence."
    }
  ]
};

describe("local store", () => {
  test("inserts conversations, messages, raw evidence, and source status", () => {
    const db = new LocalDatabase();
    const result = db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [conversation],
      confidence: "stable",
      confidenceReason: "Fixture matches timestamp/type/payload JSONL shape."
    });

    expect(result.conversations).toBe(1);
    expect(result.messages).toBe(2);
    expect(result.rawEvidence).toBe(1);
    expect(db.sources()[0]?.health).toBe("healthy");
    expect(db.open(db.today("2026-05-21")[0]!.id)).toMatchObject({
      title: "RecallBase sync planning",
      messages: [{ role: "user" }, { role: "assistant" }]
    });
  });

  test("repeated import is idempotent for raw evidence and messages", () => {
    const db = new LocalDatabase();
    const batch = {
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [conversation],
      confidence: "stable" as const,
      confidenceReason: "Fixture matches timestamp/type/payload JSONL shape."
    };

    db.importBatch(batch);
    db.importBatch(batch);

    expect(db.search("encrypted raw evidence")).toHaveLength(1);
    expect(db.open(db.search("sync")[0]!.id)).toMatchObject({ messageCount: 2 });
  });

  test("stores message thinking separately and keeps it searchable", () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "browser-extension-deepseek",
      sourceLabel: "DeepSeek",
      conversations: [{
        ...conversation,
        sourceId: "browser-extension-deepseek",
        sourceLabel: "DeepSeek",
        upstreamId: "deepseek-session",
        messages: [
          { role: "user", createdAt: "2026-05-21T08:00:00.000Z", text: "Prompt" },
          { role: "assistant", createdAt: "2026-05-21T08:01:00.000Z", thinking: "Standalone chain text", text: "Final answer" }
        ],
        rawEvidence: []
      }],
      confidence: "experimental",
      confidenceReason: "Browser extension fixture."
    });

    const searchResult = db.search("Standalone")[0]!;
    expect(searchResult.snippet).toContain("[thinking]");
    expect(searchResult.snippet).toContain("Standalone chain text");
    expect(searchResult.snippet).not.toContain("Final answer [thinking]");

    const opened = db.open(searchResult.id);
    expect(opened).not.toBe("ambiguous");
    if (opened && opened !== "ambiguous") {
      expect(opened.messages[1]?.thinking).toBe("Standalone chain text");
      expect(opened.messages[1]?.text).toBe("Final answer");
    }
  });

  test("partial browser re-import preserves message metadata and stable ids", () => {
    const db = new LocalDatabase();
    const batch = {
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "ChatGPT",
      scope: "partial" as const,
      conversations: [{
        sourceId: "browser-extension-chatgpt",
        sourceLabel: "ChatGPT",
        upstreamId: "conversation-1",
        title: "Browser metadata",
        startedAt: "2026-05-21T08:00:00.000Z",
        updatedAt: "2026-05-21T08:01:00.000Z",
        rawEvidence: [],
        messages: [{
          upstreamId: "m1",
          role: "assistant" as const,
          createdAt: "2026-05-21T08:01:00.000Z",
          updatedAt: "2026-05-21T08:01:30.000Z",
          text: "Metadata should survive.",
          modelId: "gpt-5",
          attachments: [{ name: "notes.md", mimeType: "text/markdown", source: "chatgpt" }],
          citations: [{ title: "Docs", url: "https://example.com/docs", source: "chatgpt" }],
          media: [{ type: "image" as const, url: "https://example.com/image.png", source: "chatgpt" }]
        }],
        metadata: { url: "https://chatgpt.com/c/conversation-1", site: "chatgpt", captureSignature: "sig-metadata" }
      }],
      confidence: "experimental" as const,
      confidenceReason: "Browser extension fixture."
    };

    db.importBatch(batch);
    const first = db.open(db.search("survive")[0]!.id);
    expect(first).not.toBe("ambiguous");
    const firstMessage = first && first !== "ambiguous" ? first.messages[0] : undefined;
    const firstId = firstMessage?.id;

    db.importBatch(batch);
    const second = db.open(db.search("survive")[0]!.id);
    expect(second).not.toBe("ambiguous");
    if (second && second !== "ambiguous") {
      expect(second.messages[0]?.id).toBe(firstId);
      expect(second.messages[0]?.updatedAt).toBe("2026-05-21T08:01:30.000Z");
      expect(second.messages[0]?.modelId).toBe("gpt-5");
      expect(second.messages[0]?.attachments).toEqual([{ name: "notes.md", mimeType: "text/markdown", source: "chatgpt" }]);
      expect(second.messages[0]?.citations).toEqual([{ title: "Docs", url: "https://example.com/docs", source: "chatgpt" }]);
      expect(second.messages[0]?.media).toEqual([{ type: "image", url: "https://example.com/image.png", source: "chatgpt" }]);
    }
  });

  test("migrates existing message rows with empty metadata defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "recallbase-migration-"));
    const path = join(dir, "recallbase.db");
    const oldDb = new Database(path, { create: true });
    oldDb.run(`
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_label TEXT NOT NULL,
        upstream_id TEXT,
        title TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        raw_evidence_refs_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      )
    `);
    oldDb.run(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        upstream_id TEXT,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        text TEXT NOT NULL,
        thinking TEXT,
        raw_evidence_id TEXT
      )
    `);
    oldDb.run(
      "INSERT INTO conversations (id, source_id, source_label, upstream_id, title, started_at, updated_at, message_count, raw_evidence_refs_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["conv_old", "browser-extension-chatgpt", "ChatGPT", "conversation-1", "Old capture", "2026-05-21T08:00:00.000Z", "2026-05-21T08:01:00.000Z", 1, "[]", "{}"]
    );
    oldDb.run(
      "INSERT INTO messages (id, conversation_id, upstream_id, role, created_at, text, thinking, raw_evidence_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["msg_old", "conv_old", "m1", "assistant", "2026-05-21T08:01:00.000Z", "Old row", null, null]
    );
    oldDb.close();

    const db = new LocalDatabase(path);
    const columns = db.db.query("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("model_id");
    expect(columns.map((column) => column.name)).toContain("updated_at");
    expect(columns.map((column) => column.name)).toContain("attachments_json");
    expect(db.open("conv_old")).toMatchObject({
      messages: [{ text: "Old row" }]
    });
    db.close();
  });

  test("duplicate upstream conversations in one batch merge messages instead of overwriting", () => {
    const db = new LocalDatabase();
    const result = db.importBatch({
      sourceId: "claude-code",
      sourceLabel: "Claude Code",
      conversations: [
        {
          ...conversation,
          sourceId: "claude-code",
          sourceLabel: "Claude Code",
          upstreamId: "shared-session",
          title: "Shared session part one",
          messages: [
            { upstreamId: "m1", role: "user", createdAt: "2026-05-21T08:00:00.000Z", text: "First file message." }
          ],
          rawEvidence: []
        },
        {
          ...conversation,
          sourceId: "claude-code",
          sourceLabel: "Claude Code",
          upstreamId: "shared-session",
          title: "Shared session part two",
          startedAt: "2026-05-21T08:05:00.000Z",
          updatedAt: "2026-05-21T08:10:00.000Z",
          messages: [
            { upstreamId: "m1", role: "user", createdAt: "2026-05-21T08:00:00.000Z", text: "First file message." },
            { upstreamId: "m2", role: "assistant", createdAt: "2026-05-21T08:10:00.000Z", text: "Second file message." }
          ],
          rawEvidence: []
        }
      ],
      confidence: "stable",
      confidenceReason: "test fixture"
    });

    expect(result).toMatchObject({ conversations: 1, messages: 2 });
    expect(db.sources()[0]).toMatchObject({ conversations: 1, messages: 2 });
    expect(db.search("file message")).toHaveLength(1);
    expect(db.open(db.search("file message")[0]!.id)).toMatchObject({
      messageCount: 2,
      messages: [{ text: "First file message." }, { text: "Second file message." }]
    });
  });

  test("source status totals survive partial source imports", () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [
        conversation,
        {
          ...conversation,
          upstreamId: "session-2",
          title: "RecallBase search planning",
          messages: [{ role: "user", createdAt: "2026-05-21T09:00:00.000Z", text: "Plan search." }],
          rawEvidence: []
        }
      ],
      confidence: "stable",
      confidenceReason: "test fixture"
    });

    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      scope: "partial",
      conversations: [{ ...conversation, title: "RecallBase sync planning updated" }],
      confidence: "stable",
      confidenceReason: "test fixture"
    });

    expect(db.sources()[0]).toMatchObject({ conversations: 2, messages: 3, rawEvidence: 1 });
  });

  test("partial imports merge with existing conversation messages", () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [
        {
          ...conversation,
          messages: [
            { upstreamId: "m1", role: "user", createdAt: "2026-05-21T08:00:00.000Z", text: "Unchanged path message." },
            { upstreamId: "m2", role: "assistant", createdAt: "2026-05-21T08:01:00.000Z", text: "Changed path message." }
          ],
          rawEvidence: []
        }
      ],
      confidence: "stable",
      confidenceReason: "test fixture"
    });

    const result = db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      scope: "partial",
      conversations: [
        {
          ...conversation,
          updatedAt: "2026-05-21T08:30:00.000Z",
          messages: [
            { upstreamId: "m2", role: "assistant", createdAt: "2026-05-21T08:01:00.000Z", text: "Changed path message." }
          ],
          rawEvidence: []
        }
      ],
      confidence: "stable",
      confidenceReason: "test fixture"
    });

    expect(result).toMatchObject({ conversations: 1, messages: 2 });
    expect(db.open(db.search("path message")[0]!.id)).toMatchObject({
      messageCount: 2,
      messages: [{ text: "Unchanged path message." }, { text: "Changed path message." }]
    });
  });

  test("browser extension imports treat API and legacy DOM ids as one conversation", () => {
    for (const item of browserIdentityFixtures()) {
      const db = new LocalDatabase();
      const sourceId = `browser-extension-${item.site}`;

      db.importBatch(browserIdentityBatch({
        sourceId,
        site: item.site,
        url: item.url,
        upstreamId: item.legacyId,
        captureSignature: `sig-${item.site}-dom`,
        startedAt: "2026-05-26T09:15:01.774Z",
        updatedAt: "2026-05-26T09:20:09.058Z"
      }));

      const result = db.importBatch(browserIdentityBatch({
        sourceId,
        site: item.site,
        url: item.url,
        upstreamId: item.canonicalId,
        captureSignature: `sig-${item.site}-api`,
        startedAt: "2026-03-12T13:07:48.316Z",
        updatedAt: "2026-03-12T13:17:37.776Z"
      }));

      expect(result, item.site).toMatchObject({ conversations: 1 });
      expect(db.sources()[0], item.site).toMatchObject({ conversations: 1 });
      const row = db.db.query("SELECT upstream_id, started_at, updated_at, message_count FROM conversations").get() as { upstream_id: string; started_at: string; updated_at: string; message_count: number };
      expect(row.upstream_id, item.site).toBe(item.canonicalId);
      expect(row.started_at, item.site).toBe("2026-03-12T13:07:48.316Z");
      expect(row.updated_at, item.site).toBe("2026-03-12T13:17:37.776Z");
      expect(row.message_count, item.site).toBe(1);
    }
  });

  test("partial imports preserve existing diagnostics and health", () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [conversation],
      diagnostics: [{ sourceId: "codex", severity: "error", code: "bad_old_file", message: "Old file is still malformed." }],
      confidence: "stable",
      confidenceReason: "test fixture"
    });

    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      scope: "partial",
      conversations: [{ ...conversation, title: "RecallBase sync planning updated" }],
      confidence: "stable",
      confidenceReason: "test fixture"
    });

    expect(db.sources()[0]).toMatchObject({ health: "partial" });
    expect(db.sources()[0]?.diagnostics.map((item) => item.code)).toContain("bad_old_file");
  });

  test("same raw content imported from a different path keeps stable raw ids", () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [conversation],
      confidence: "stable",
      confidenceReason: "Fixture matches timestamp/type/payload JSONL shape."
    });
    const firstRawId = (db.open(db.search("sync")[0]!.id) as Exclude<ReturnType<LocalDatabase["open"]>, undefined | "ambiguous">).rawEvidenceRefs[0];

    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [
        {
          ...conversation,
          rawEvidence: [
            {
              sourceId: "codex",
              uri: "file:///moved/session-1.jsonl#L1",
              content: conversation.rawEvidence[0]!.content
            }
          ],
          messages: conversation.messages.map((message) => ({
            ...message,
            rawEvidenceUri: "file:///moved/session-1.jsonl#L1"
          }))
        }
      ],
      confidence: "stable",
      confidenceReason: "Fixture matches timestamp/type/payload JSONL shape."
    });

    const secondRawId = (db.open(db.search("sync")[0]!.id) as Exclude<ReturnType<LocalDatabase["open"]>, undefined | "ambiguous">).rawEvidenceRefs[0];
    expect(secondRawId).toBe(firstRawId);
  });

  test("full source re-import removes stale raw evidence when importer no longer emits it", () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [conversation],
      confidence: "stable",
      confidenceReason: "test fixture"
    });

    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [
        {
          ...conversation,
          rawEvidence: [],
          messages: conversation.messages.map(({ rawEvidenceUri: _rawEvidenceUri, ...message }) => message)
        }
      ],
      confidence: "stable",
      confidenceReason: "test fixture"
    });

    const opened = db.open(db.search("sync")[0]!.id) as Exclude<ReturnType<LocalDatabase["open"]>, undefined | "ambiguous">;
    expect(db.sources()[0]).toMatchObject({ rawEvidence: 0 });
    expect(opened.rawEvidenceRefs).toEqual([]);
    expect(opened.messages.some((message) => message.rawEvidenceId)).toBe(false);
  });

  test("full source re-import prunes conversations omitted without errors", () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [
        conversation,
        {
          ...conversation,
          upstreamId: "session-empty-later",
          title: "Stale no-message session",
          messages: [{ role: "user", createdAt: "2026-05-21T09:00:00.000Z", text: "This should disappear." }],
          rawEvidence: []
        }
      ],
      confidence: "stable",
      confidenceReason: "test fixture"
    });

    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [conversation],
      diagnostics: [{ sourceId: "codex", severity: "warning", code: "codex_no_messages", message: "Skipped empty session." }],
      confidence: "stable",
      confidenceReason: "test fixture"
    });

    expect(db.sources()[0]).toMatchObject({ conversations: 1, messages: 2 });
    expect(db.search("disappear")).toEqual([]);
  });

  test("captures parser diagnostics without corrupting successful records", () => {
    const db = new LocalDatabase();
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      conversations: [conversation],
      diagnostics: [
        {
          sourceId: "codex",
          severity: "error",
          code: "jsonl_malformed",
          message: "Line 3 is not valid JSON.",
          evidenceRef: "file:///codex/session-1.jsonl#L3"
        }
      ],
      confidence: "stable",
      confidenceReason: "Fixture matches timestamp/type/payload JSONL shape."
    });

    const source = db.sources()[0]!;
    expect(source.diagnostics[0]?.code).toBe("jsonl_malformed");
    expect(db.search("sync")).toHaveLength(1);
  });

  test("backup stream errors reject cleanly", async () => {
    const db = new LocalDatabase();
    const dir = mkdtempSync(join(tmpdir(), "rb-backup-error-"));

    await expect(db.writeBackup(dir)).rejects.toThrow();
  });
});

function browserIdentityBatch(input: {
  sourceId: string;
  site: string;
  url: string;
  upstreamId: string;
  captureSignature: string;
  startedAt: string;
  updatedAt: string;
}) {
  return {
    sourceId: input.sourceId,
    sourceLabel: input.site,
    scope: "partial" as const,
    conversations: [
      {
        sourceId: input.sourceId,
        sourceLabel: input.site,
        upstreamId: input.upstreamId,
        title: `${input.site} capture`,
        startedAt: input.startedAt,
        updatedAt: input.updatedAt,
        rawEvidence: [],
        messages: [
          { upstreamId: `${input.upstreamId}:0`, role: "user" as const, createdAt: input.startedAt, text: `${input.site} prompt` }
        ],
        metadata: { url: input.url, site: input.site, captureSignature: input.captureSignature }
      }
    ],
    confidence: "experimental" as const,
    confidenceReason: "test fixture"
  };
}

function browserIdentityFixtures() {
  return [
    {
      site: "perplexity",
      url: "https://www.perplexity.ai/search/c040b6de-c1f6-4f91-893c-e48c4b08deb7",
      legacyId: "search_c040b6de-c1f6-4f91-893c-e48c4b08deb7",
      canonicalId: "c040b6de-c1f6-4f91-893c-e48c4b08deb7"
    },
    {
      site: "deepseek",
      url: "https://chat.deepseek.com/a/chat/s/6b096b1a-a8a3-4870-8fa4-94beb4886c7e",
      legacyId: "a_chat_s_6b096b1a-a8a3-4870-8fa4-94beb4886c7e",
      canonicalId: "6b096b1a-a8a3-4870-8fa4-94beb4886c7e"
    },
    {
      site: "grok",
      url: "https://grok.com/c/29fd9c8d-f511-42be-a299-927d95230324?rid=a3cb3245-a0a4-4311-bded-9c351798c8f3",
      legacyId: "c_29fd9c8d-f511-42be-a299-927d95230324",
      canonicalId: "29fd9c8d-f511-42be-a299-927d95230324"
    },
    {
      site: "microsoft-copilot",
      url: "https://copilot.microsoft.com/chats/UAvvceaKoXc1EGJTBNP1o",
      legacyId: "chats_UAvvceaKoXc1EGJTBNP1o",
      canonicalId: "UAvvceaKoXc1EGJTBNP1o"
    },
    {
      site: "yuanbao",
      url: "https://yuanbao.tencent.com/chat/naQivTmsDa/099af220-89d8-45b6-967c-3b71f78c6ca9",
      legacyId: "chat_naQivTmsDa_099af220-89d8-45b6-967c-3b71f78c6ca9",
      canonicalId: "099af220-89d8-45b6-967c-3b71f78c6ca9"
    },
    {
      site: "gemini",
      url: "https://gemini.google.com/app/920096179004d011",
      legacyId: "app_920096179004d011",
      canonicalId: "920096179004d011"
    },
    {
      site: "notebooklm",
      url: "https://notebooklm.google.com/notebook/903e6777-7404-41e0-bb5a-1ec7418d8b66",
      legacyId: "notebook_903e6777-7404-41e0-bb5a-1ec7418d8b66",
      canonicalId: "903e6777-7404-41e0-bb5a-1ec7418d8b66"
    },
    {
      site: "google-ai-studio",
      url: "https://aistudio.google.com/prompts/1ylegyBnb6v-82ODO5zpUOE0FXv0RefRh",
      legacyId: "prompts_1ylegyBnb6v-82ODO5zpUOE0FXv0RefRh",
      canonicalId: "1ylegyBnb6v-82ODO5zpUOE0FXv0RefRh"
    },
    {
      site: "github-copilot",
      url: "https://github.com/copilot/c/1d2b0246-6427-407e-bf19-42a83ff81fba",
      legacyId: "copilot_c_1d2b0246-6427-407e-bf19-42a83ff81fba",
      canonicalId: "1d2b0246-6427-407e-bf19-42a83ff81fba"
    }
  ] as const;
}
