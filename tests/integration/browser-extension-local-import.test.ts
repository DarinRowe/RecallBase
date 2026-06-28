import { describe, expect, test } from "bun:test";
import { LocalDatabase, querySearch } from "../../packages/core/src";
import { capturePayloadToImportBatch } from "../../apps/cli/src/commands/extension-host";

describe("browser extension local import", () => {
  test("captured browser conversations are first-class local records and sync documents", () => {
    const db = new LocalDatabase();
    db.importBatch(capturePayloadToImportBatch({
      schemaVersion: 1,
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "ChatGPT",
      site: "chatgpt",
      upstreamConversationId: "conversation-1",
      url: "https://chatgpt.com/c/conversation-1",
      title: "Browser local import",
      capturedAt: "2026-05-21T10:00:00.000Z",
      startedAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:01:00.000Z",
      messages: [{ role: "assistant", createdAt: "2026-05-21T10:01:00.000Z", text: "Browser captures reach rb search before cloud sync." }],
      diagnostics: [],
      captureSignature: "sig-1"
    }));

    const search = querySearch(db, "cloud sync");
    const backup = db.createBackup("2026-05-21T11:00:00.000Z");
    expect(search.ok).toBe(true);
    if (search.ok) {
      expect(search.data.results[0]).toMatchObject({
        sourceId: "browser-extension-chatgpt",
        sourceLabel: "ChatGPT"
      });
    }
    expect(db.syncSearchDocuments()[0]).toMatchObject({ sourceId: "browser-extension-chatgpt" });
    expect(db.syncConversationDetails()[0]?.messages[0]?.text).toContain("rb search");
    expect(backup.conversations[0]?.rawEvidenceRefs).toEqual([]);
    expect(backup.conversations[0]?.metadata).toMatchObject({
      url: "https://chatgpt.com/c/conversation-1",
      site: "chatgpt",
      capturedAt: "2026-05-21T10:00:00.000Z",
      captureSignature: "sig-1",
      evidenceUri: "browser-extension://captures/sig-1"
    });
  });

  test("repeated browser auto-saves with the same capture signature update one local record", () => {
    const db = new LocalDatabase();
    const basePayload = {
      schemaVersion: 1 as const,
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "ChatGPT",
      site: "chatgpt",
      upstreamConversationId: "conversation-1",
      url: "https://chatgpt.com/c/conversation-1",
      title: "Browser local import",
      capturedAt: "2026-05-21T10:00:00.000Z",
      startedAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
      messages: [
        { upstreamId: "conversation-1:message:0", role: "assistant" as const, createdAt: "2026-05-21T10:00:00.000Z", text: "Same visible page." }
      ],
      diagnostics: [],
      captureSignature: "stable-visible-page"
    };

    db.importBatch(capturePayloadToImportBatch(basePayload));
    db.importBatch(capturePayloadToImportBatch({
      ...basePayload,
      capturedAt: "2026-05-21T10:01:00.000Z",
      startedAt: "2026-05-21T10:01:00.000Z",
      updatedAt: "2026-05-21T10:01:00.000Z",
      messages: basePayload.messages.map((message) => ({ ...message, createdAt: "2026-05-21T10:01:00.000Z" }))
    }));

    const results = querySearch(db, "Same visible page.");
    expect(results.ok).toBe(true);
    if (results.ok) expect(results.data.results).toHaveLength(1);
    expect(db.sources().find((source) => source.id === "browser-extension-chatgpt")).toMatchObject({
      conversations: 1,
      messages: 1
    });
  });

  test("browser captures with new signatures still update the same upstream conversation", () => {
    const db = new LocalDatabase();
    const basePayload = {
      schemaVersion: 1 as const,
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "ChatGPT",
      site: "chatgpt",
      upstreamConversationId: "conversation-1",
      url: "https://chatgpt.com/c/conversation-1",
      title: "Browser local import",
      capturedAt: "2026-05-21T10:00:00.000Z",
      startedAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
      messages: [
        { upstreamId: "conversation-1:message:0", role: "user" as const, createdAt: "2026-05-21T10:00:00.000Z", text: "First visible message." }
      ],
      diagnostics: []
    };

    db.importBatch(capturePayloadToImportBatch({ ...basePayload, captureSignature: "chatgpt-1-message" }));
    db.importBatch(capturePayloadToImportBatch({
      ...basePayload,
      captureSignature: "chatgpt-2-messages",
      capturedAt: "2026-05-21T10:02:00.000Z",
      updatedAt: "2026-05-21T10:02:00.000Z",
      messages: [
        ...basePayload.messages,
        { upstreamId: "conversation-1:message:1", role: "assistant" as const, createdAt: "2026-05-21T10:02:00.000Z", text: "Second visible message." }
      ]
    }));

    expect(db.sources().find((source) => source.id === "browser-extension-chatgpt")).toMatchObject({
      conversations: 1,
      messages: 2
    });
    const results = querySearch(db, "Second visible message.");
    expect(results.ok).toBe(true);
    if (results.ok) expect(results.data.results).toHaveLength(1);
  });

  test("browser native imports are partial and do not delete other browser conversations", () => {
    const db = new LocalDatabase();
    const payload = (conversationId: string, text: string, captureSignature: string) => ({
      schemaVersion: 1 as const,
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "ChatGPT",
      site: "chatgpt",
      upstreamConversationId: conversationId,
      url: `https://chatgpt.com/c/${conversationId}`,
      title: conversationId,
      capturedAt: "2026-05-21T10:00:00.000Z",
      startedAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
      messages: [{ upstreamId: `${conversationId}:message:0`, role: "assistant" as const, createdAt: "2026-05-21T10:00:00.000Z", text }],
      diagnostics: [],
      captureSignature
    });

    db.importBatch(capturePayloadToImportBatch(payload("conversation-a", "First browser conversation.", "sig-a")));
    db.importBatch(capturePayloadToImportBatch(payload("conversation-b", "Second browser conversation.", "sig-b")));

    expect(db.sources().find((source) => source.id === "browser-extension-chatgpt")).toMatchObject({
      conversations: 2,
      messages: 2
    });
    const first = querySearch(db, "First browser conversation.");
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.data.results).toHaveLength(1);
  });

  test("browser import cleans up legacy duplicate conversations with the same capture signature", () => {
    const db = new LocalDatabase();
    const metadata = {
      url: "https://chatgpt.com/c/conversation-1",
      site: "chatgpt",
      capturedAt: "2026-05-21T09:59:00.000Z",
      captureSignature: "legacy-duplicate",
      evidenceUri: "browser-extension://captures/legacy-duplicate"
    };
    for (const id of ["legacy-old", "legacy-new"]) {
      db.db
        .query(
          `INSERT INTO conversations
           (id, source_id, source_label, upstream_id, title, started_at, updated_at, message_count, raw_evidence_refs_json, metadata_json)
           VALUES (?, 'browser-extension-chatgpt', 'ChatGPT', 'conversation-1', 'Browser local import', '2026-05-21T09:59:00.000Z', '2026-05-21T09:59:00.000Z', 1, '[]', ?)`
        )
        .run(id, JSON.stringify(metadata));
      db.db
        .query("INSERT INTO messages (id, conversation_id, upstream_id, role, created_at, text, raw_evidence_id) VALUES (?, ?, 'm1', 'assistant', '2026-05-21T09:59:00.000Z', 'Legacy duplicate text.', null)")
        .run(`msg-${id}`, id);
      db.db
        .query("INSERT INTO conversation_fts (conversation_id, message_id, title, content) VALUES (?, ?, 'Browser local import', 'Legacy duplicate text.')")
        .run(id, `msg-${id}`);
    }

    db.importBatch(capturePayloadToImportBatch({
      schemaVersion: 1,
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "ChatGPT",
      site: "chatgpt",
      upstreamConversationId: "conversation-1",
      url: "https://chatgpt.com/c/conversation-1",
      title: "Browser local import",
      capturedAt: "2026-05-21T10:00:00.000Z",
      startedAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
      messages: [{ upstreamId: "m1", role: "assistant", createdAt: "2026-05-21T10:00:00.000Z", text: "Canonical text." }],
      diagnostics: [],
      captureSignature: "legacy-duplicate"
    }));

    const remaining = db.db
      .query("SELECT count(*) AS count FROM conversations WHERE source_id = 'browser-extension-chatgpt'")
      .get() as { count: number };
    expect(remaining.count).toBe(1);
    const legacy = querySearch(db, "Legacy duplicate text.");
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.data.results).toHaveLength(1);
    const canonical = querySearch(db, "Canonical text.");
    expect(canonical.ok).toBe(true);
    if (canonical.ok) expect(canonical.data.results).toHaveLength(1);
  });

  test("browser import cleans up legacy duplicate conversations with different capture signatures", () => {
    const db = new LocalDatabase();
    for (const [id, captureSignature] of [["legacy-old", "legacy-old-signature"], ["legacy-new", "legacy-new-signature"]]) {
      db.db
        .query(
          `INSERT INTO conversations
           (id, source_id, source_label, upstream_id, title, started_at, updated_at, message_count, raw_evidence_refs_json, metadata_json)
           VALUES (?, 'browser-extension-chatgpt', 'ChatGPT', 'conversation-1', 'Browser local import', '2026-05-21T09:59:00.000Z', '2026-05-21T09:59:00.000Z', 1, '[]', ?)`
        )
        .run(id, JSON.stringify({
          url: "https://chatgpt.com/c/conversation-1",
          site: "chatgpt",
          capturedAt: "2026-05-21T09:59:00.000Z",
          captureSignature,
          evidenceUri: `browser-extension://captures/${captureSignature}`
        }));
      db.db
        .query("INSERT INTO messages (id, conversation_id, upstream_id, role, created_at, text, raw_evidence_id) VALUES (?, ?, 'm1', 'assistant', '2026-05-21T09:59:00.000Z', 'Legacy duplicate text.', null)")
        .run(`msg-${id}`, id);
      db.db
        .query("INSERT INTO conversation_fts (conversation_id, message_id, title, content) VALUES (?, ?, 'Browser local import', 'Legacy duplicate text.')")
        .run(id, `msg-${id}`);
    }

    db.importBatch(capturePayloadToImportBatch({
      schemaVersion: 1,
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "ChatGPT",
      site: "chatgpt",
      upstreamConversationId: "conversation-1",
      url: "https://chatgpt.com/c/conversation-1",
      title: "Browser local import",
      capturedAt: "2026-05-21T10:00:00.000Z",
      startedAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
      messages: [{ upstreamId: "m1", role: "assistant", createdAt: "2026-05-21T10:00:00.000Z", text: "Canonical text." }],
      diagnostics: [],
      captureSignature: "fresh-signature"
    }));

    const remaining = db.db
      .query("SELECT count(*) AS count FROM conversations WHERE source_id = 'browser-extension-chatgpt'")
      .get() as { count: number };
    expect(remaining.count).toBe(1);
    const legacy = querySearch(db, "Legacy duplicate text.");
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.data.results).toHaveLength(1);
    const canonical = querySearch(db, "Canonical text.");
    expect(canonical.ok).toBe(true);
    if (canonical.ok) expect(canonical.data.results).toHaveLength(1);
  });

  test("browser import merges messages from legacy duplicate upstream conversations before cleanup", () => {
    const db = new LocalDatabase();
    for (const [id, text] of [["legacy-old", "Old duplicate-only text."], ["legacy-new", "New duplicate-only text."]]) {
      db.db
        .query(
          `INSERT INTO conversations
           (id, source_id, source_label, upstream_id, title, started_at, updated_at, message_count, raw_evidence_refs_json, metadata_json)
           VALUES (?, 'browser-extension-chatgpt', 'ChatGPT', 'conversation-1', 'Browser local import', '2026-05-21T09:59:00.000Z', '2026-05-21T09:59:00.000Z', 1, '[]', ?)`
        )
        .run(id, JSON.stringify({
          url: "https://chatgpt.com/c/conversation-1",
          site: "chatgpt",
          capturedAt: "2026-05-21T09:59:00.000Z",
          captureSignature: `${id}-signature`,
          evidenceUri: `browser-extension://captures/${id}-signature`
        }));
      db.db
        .query("INSERT INTO messages (id, conversation_id, upstream_id, role, created_at, text, raw_evidence_id) VALUES (?, ?, ?, 'assistant', '2026-05-21T09:59:00.000Z', ?, null)")
        .run(`msg-${id}`, id, `message-${id}`, text);
      db.db
        .query("INSERT INTO conversation_fts (conversation_id, message_id, title, content) VALUES (?, ?, 'Browser local import', ?)")
        .run(id, `msg-${id}`, text);
    }

    db.importBatch(capturePayloadToImportBatch({
      schemaVersion: 1,
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "ChatGPT",
      site: "chatgpt",
      upstreamConversationId: "conversation-1",
      url: "https://chatgpt.com/c/conversation-1",
      title: "Browser local import",
      capturedAt: "2026-05-21T10:00:00.000Z",
      startedAt: "2026-05-21T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
      messages: [{ upstreamId: "fresh-message", role: "assistant", createdAt: "2026-05-21T10:00:00.000Z", text: "Fresh canonical text." }],
      diagnostics: [],
      captureSignature: "fresh-signature"
    }));

    expect(db.sources().find((source) => source.id === "browser-extension-chatgpt")).toMatchObject({
      conversations: 1,
      messages: 3
    });
    const old = querySearch(db, "Old duplicate-only text.");
    const newer = querySearch(db, "New duplicate-only text.");
    const fresh = querySearch(db, "Fresh canonical text.");
    expect(old.ok && old.data.results).toHaveLength(1);
    expect(newer.ok && newer.data.results).toHaveLength(1);
    expect(fresh.ok && fresh.data.results).toHaveLength(1);
  });
});
