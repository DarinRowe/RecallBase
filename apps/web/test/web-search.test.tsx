import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { encryptConversationChunk, generateDeviceRawKey, importDeviceRawKey } from "@recallbase/core";
import { createRecallBaseClient } from "../src";
import { decryptConversationMessages } from "../src/api/decryption";
import { ConversationPage } from "../src/pages/conversation";
import { SearchPage } from "../src/pages/search";

describe("web search states", () => {
  test("renders synced-empty and filtered zero-result states distinctly", () => {
    const empty = renderToStaticMarkup(<SearchPage state="synced_empty" />);
    const zero = renderToStaticMarkup(<SearchPage state="ready" query="missing" results={[]} sources={[]} />);

    expect(empty).toContain("No synced data yet");
    expect(zero).toContain("No synced results match this search");
  });

  test("renders partial source status in search results", () => {
    const html = renderToStaticMarkup(
      <SearchPage
        state="ready"
        query="sync"
        results={[
          {
            id: "doc_1",
            conversationId: "conv_1",
            sourceId: "codex",
            title: "Sync",
            updatedAt: "2026-05-21T10:00:00.000Z",
            snippet: "Readable synced snippet."
          }
        ]}
        sources={[
          {
            id: "codex",
            label: "Codex",
            health: "partial",
            confidence: "stable",
            confidenceReason: "fixture",
            conversations: 1,
            messages: 1,
            rawEvidence: 1,
            diagnostics: []
          }
        ]}
      />
    );

    expect(html).toContain("Some sources are partially synced");
    expect(html).toContain("Readable synced snippet");
  });

  test("conversation detail renders imported text safely as escaped text", () => {
    const html = renderToStaticMarkup(
      <ConversationPage
        state="ready"
        document={{
          id: "doc_1",
          conversationId: "conv_1",
          sourceId: "codex",
          title: "<img src=x onerror=alert(1)>",
          updatedAt: "2026-05-21T10:00:00.000Z",
          snippet: "<script>alert(1)</script>"
        }}
      />
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Full transcript and raw evidence are not readable");
  });

  test("conversation detail shows encrypted chunks as locked without an imported key", () => {
    const html = renderToStaticMarkup(
      <ConversationPage
        state="ready"
        document={{
          id: "doc_1",
          conversationId: "conv_1",
          sourceId: "codex",
          title: "Encrypted",
          updatedAt: "2026-05-21T10:00:00.000Z",
          snippet: "Snippet only."
        }}
        encryptedConversationChunks={[
          {
            conversationId: "conv_1",
            chunkId: "part_1",
            partIndex: 0,
            partCount: 1,
            messageCount: 1,
            keyId: "rawkey_fixture",
            keyVersion: 1,
            algorithm: "AES-GCM",
            ivBase64Url: "MTIzNDU2Nzg5MDEy",
            ciphertextBase64Url: "Y2lwaGVydGV4dA",
            contentHashBase64Url: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            encryptedAt: "2026-05-21T10:00:00.000Z",
            objectKey: "users/user-a/conversations/conv_1/part_1"
          }
        ]}
      />
    );

    expect(html).toContain("Encrypted Messages");
    expect(html).toContain("Browser-side unlock is deferred for hosted V1");
    expect(html).toContain("1 chunks");
  });

  test("conversation detail renders decrypted messages safely", () => {
    const html = renderToStaticMarkup(
      <ConversationPage
        state="ready"
        document={{
          id: "doc_1",
          conversationId: "conv_1",
          sourceId: "codex",
          title: "Encrypted",
          updatedAt: "2026-05-21T10:00:00.000Z",
          snippet: "Snippet only."
        }}
        decryptedMessages={[
          {
            id: "msg_1",
            role: "user",
            createdAt: "2026-05-21T10:00:00.000Z",
            text: "<script>alert(1)</script>"
          }
        ]}
      />
    );

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  test("browser decryption helper reconstructs encrypted chunks and rejects wrong keys", async () => {
    const key = await generateDeviceRawKey(new Date("2026-05-21T10:00:00.000Z"));
    const wrongKey = await generateDeviceRawKey(new Date("2026-05-21T10:00:00.000Z"));
    const imported = await importDeviceRawKey(key);
    const chunk = await encryptConversationChunk(
      {
        conversationId: "conv_1",
        chunkId: "part_1",
        partIndex: 0,
        partCount: 1,
        messages: [
          {
            id: "msg_1",
            role: "assistant",
            createdAt: "2026-05-21T10:00:00.000Z",
            text: "Browser decrypts locally."
          }
        ]
      },
      imported,
      new Date("2026-05-21T10:01:00.000Z")
    );

    await expect(decryptConversationMessages([{ ...chunk, objectKey: "users/user-a/conversations/conv_1/part_1" }], wrongKey))
      .rejects.toThrow("different device-local key");
    await expect(decryptConversationMessages([{ ...chunk, objectKey: "users/user-a/conversations/conv_1/part_1" }], key))
      .resolves.toEqual([
        {
          id: "msg_1",
          role: "assistant",
          createdAt: "2026-05-21T10:00:00.000Z",
          text: "Browser decrypts locally."
        }
      ]);
  });

  test("conversation not found state covers stale or incomplete sync batches", () => {
    const html = renderToStaticMarkup(<ConversationPage state="not_found" />);

    expect(html).toContain("not synced, no longer synced, or hidden");
  });

  test("API client preserves path-prefixed base URLs for search", async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ ok: true, data: { results: [] } }), {
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch;

    try {
      await createRecallBaseClient("/recallbase").search({ query: "sync" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(seen[0]).toBe("/recallbase/api/search?q=sync");
  });
});
