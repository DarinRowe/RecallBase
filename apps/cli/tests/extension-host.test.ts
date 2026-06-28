import { describe, expect, test } from "bun:test";
import { LocalDatabase } from "@recallbase/core";
import { browserSites } from "@recallbase/contracts";
import { encodeNativeMessage, decodeNativeMessage, parseNativeRequest, readNativeMessage } from "../src/extension/native-protocol";
import { capturePayloadToImportBatch, handleExtensionHostRequest } from "../src/commands/extension-host";
import packageJson from "../../../package.json";

const payload = {
  schemaVersion: 1 as const,
  sourceId: "browser-extension-chatgpt",
  sourceLabel: "ChatGPT",
  site: "chatgpt",
  upstreamConversationId: "conversation-1",
  url: "https://chatgpt.com/c/conversation-1?token=secret#fragment",
  title: "Browser capture",
  capturedAt: "2026-05-21T10:00:00.000Z",
  startedAt: "2026-05-21T10:00:00.000Z",
  updatedAt: "2026-05-21T10:01:00.000Z",
  branch: { leafId: "m2", pathIds: ["root", "m1", "m2"], createdAt: "2026-05-21T10:01:00.000Z" },
  messages: [
    { upstreamId: "m1", role: "user" as const, createdAt: "2026-05-21T10:00:00.000Z", text: "Capture this ChatGPT thread." },
    {
      upstreamId: "m2",
      upstreamIds: ["m2", "tool-image"],
      role: "assistant" as const,
      createdAt: "2026-05-21T10:01:00.000Z",
      updatedAt: "2026-05-21T10:01:30.000Z",
      text: "Import it into local RecallBase. ![chart](https://example.com/chart.png?signature=secret#frag)",
      thinking: "Use the native host. ![draft](<https://example.com/draft.png?token=secret#frag>)",
      modelId: "gpt-5",
      attachments: [{
        id: "attachment-1",
        name: "notes.md",
        mimeType: "text/markdown",
        source: "chatgpt",
        sizeBytes: 42,
        url: "https://example.com/notes.md?token=secret#frag",
        width: 640,
        height: 480
      }],
      citations: [{ title: "Docs", url: "https://example.com/docs?token=secret#section", source: "chatgpt" }],
      media: [{
        type: "image" as const,
        url: "https://example.com/image.png?signature=secret",
        title: "Chart",
        description: "A generated chart",
        thumbnailUrl: "https://example.com/thumb.png?token=secret#frag",
        duration: "PT1M02S",
        views: 123,
        uploadedAt: "2026-01-01",
        source: "chatgpt"
      }]
    }
  ],
  diagnostics: [],
  captureSignature: "sig-1"
};

describe("extension native host", () => {
  test("health reports the package version", async () => {
    const db = new LocalDatabase();
    const response = await handleExtensionHostRequest({ flags: { json: true, force: false, dbPath: ":memory:", roots: [], sourceIds: [] }, db }, {
      type: "health",
      protocolVersion: 1
    });

    expect(response).toMatchObject({ ok: true, type: "health", version: packageJson.version });
  });

  test("imports a browser capture into local search", async () => {
    const db = new LocalDatabase();
    const response = await handleExtensionHostRequest({ flags: { json: true, force: false, dbPath: ":memory:", roots: [], sourceIds: [] }, db }, {
      type: "import",
      protocolVersion: 1,
      payload
    });

    expect(response.ok).toBe(true);
    expect(db.search("ChatGPT thread")).toHaveLength(1);
    const opened = db.open(db.search("RecallBase")[0]!.id);
    expect(opened).toMatchObject({
      sourceId: "browser-extension-chatgpt",
      sourceLabel: "ChatGPT",
      messageCount: 2
    });
    if (opened && opened !== "ambiguous") {
      expect(capturePayloadToImportBatch(payload).conversations[0]?.messages[1]?.updatedAt).toBe("2026-05-21T10:01:30.000Z");
      expect(capturePayloadToImportBatch(payload).conversations[0]?.messages[1]?.upstreamIds).toEqual(["m2", "tool-image"]);
      expect(capturePayloadToImportBatch(payload).conversations[0]?.metadata?.branch).toEqual({ leafId: "m2", pathIds: ["root", "m1", "m2"], createdAt: "2026-05-21T10:01:00.000Z" });
      expect(opened.messages[1]?.upstreamIds).toEqual(["m2", "tool-image"]);
      expect(opened.messages[1]?.text).toContain("![chart](https://example.com/chart.png)");
      expect(opened.messages[1]?.thinking).toBe("Use the native host. ![draft](<https://example.com/draft.png>)");
      expect(opened.messages[1]?.modelId).toBe("gpt-5");
      expect(opened.messages[1]?.attachments).toEqual([{
        id: "attachment-1",
        name: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 42,
        url: "https://example.com/notes.md",
        width: 640,
        height: 480,
        source: "chatgpt"
      }]);
      expect(opened.messages[1]?.citations).toEqual([{ title: "Docs", url: "https://example.com/docs", source: "chatgpt" }]);
      expect(opened.messages[1]?.media).toEqual([{
        type: "image",
        url: "https://example.com/image.png",
        title: "Chart",
        description: "A generated chart",
        thumbnailUrl: "https://example.com/thumb.png",
        duration: "PT1M02S",
        views: 123,
        uploadedAt: "2026-01-01",
        source: "chatgpt"
      }]);
      expect(JSON.stringify(opened.messages[1])).not.toContain("signature=secret");
      expect(JSON.stringify(opened.messages[1])).not.toContain("token=secret");
    }
  });

  test("repeated import is idempotent", () => {
    const db = new LocalDatabase();
    const batch = capturePayloadToImportBatch(payload);

    db.importBatch(batch);
    db.importBatch(batch);

    expect(db.search("local RecallBase")).toHaveLength(1);
    const opened = db.open(db.search("local RecallBase")[0]!.id);
    expect(batch.conversations[0]?.metadata?.url).toBe("https://chatgpt.com/c/conversation-1");
    if (opened && opened !== "ambiguous") {
      expect(opened.messages[1]?.modelId).toBe("gpt-5");
      expect(opened.messages[1]?.citations).toEqual([{ title: "Docs", url: "https://example.com/docs", source: "chatgpt" }]);
      expect(opened.messages[1]?.media?.[0]).toMatchObject({ type: "image", url: "https://example.com/image.png", thumbnailUrl: "https://example.com/thumb.png" });
    }
  });

  test("imports ChatGPT alternate branches as separate conversations", () => {
    const db = new LocalDatabase();
    db.importBatch(capturePayloadToImportBatch(payload));
    db.importBatch(capturePayloadToImportBatch({
      ...payload,
      upstreamConversationId: "conversation-1#branch:a-old",
      title: "Browser capture (Alternate branch 1)",
      captureSignature: "sig-branch-a-old",
      messages: [
        { upstreamId: "u-old", role: "user", createdAt: "2026-05-21T09:00:00.000Z", text: "Old branch prompt." },
        { upstreamId: "a-old", role: "assistant", createdAt: "2026-05-21T09:01:00.000Z", text: "Old branch answer." }
      ]
    }));

    expect(db.sources().find((source) => source.id === "browser-extension-chatgpt")).toMatchObject({
      conversations: 2,
      messages: 4
    });
    expect(db.search("Old branch answer")).toHaveLength(1);
    expect(db.search("Capture this ChatGPT thread")).toHaveLength(1);
  });

  test("round-trips length-prefixed native messages", () => {
    const decoded = decodeNativeMessage(encodeNativeMessage({ type: "health", protocolVersion: 1 }));

    expect(decoded).toEqual({ type: "health", protocolVersion: 1 });
  });

  test("reads one native message frame without waiting for stdin EOF", () => {
    const frame = encodeNativeMessage({ type: "health", protocolVersion: 1 });
    let cursor = 0;
    const decoded = readNativeMessage((buffer, offset, length) => {
      const chunkLength = Math.min(length, 2, frame.byteLength - cursor);
      if (chunkLength <= 0) throw new Error("reader should not wait for EOF");
      buffer.set(frame.slice(cursor, cursor + chunkLength), offset);
      cursor += chunkLength;
      return chunkLength;
    });

    expect(decoded).toEqual({ type: "health", protocolVersion: 1 });
    expect(cursor).toBe(frame.byteLength);
  });

  test("malformed payload returns bounded protocol error", async () => {
    const db = new LocalDatabase();
    const response = await handleExtensionHostRequest({ flags: { json: true, force: false, dbPath: ":memory:", roots: [], sourceIds: [] }, db }, {
      type: "import",
      protocolVersion: 1,
      payload: { ...payload, sourceId: "browser-extension:chatgpt" }
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.message).toContain("Invalid sourceId");
  });

  test("rejects unsupported browser capture hosts and source mismatches", async () => {
    expect(() => capturePayloadToImportBatch({ ...payload, url: "https://example.com/c/conversation-1" }))
      .toThrow("not supported");
    expect(() => capturePayloadToImportBatch({ ...payload, sourceId: "browser-extension-claude" }))
      .toThrow("not supported");
    expect(() => capturePayloadToImportBatch({ ...payload, url: "http://chatgpt.com/c/conversation-1" }))
      .toThrow("HTTPS");
  });

  test("accepts newly supported browser capture sources", () => {
    const supported = [
      ["perplexity", "Perplexity", "https://www.perplexity.ai/search/what-is-recallbase"],
      ["notebooklm", "NotebookLM", "https://notebooklm.google.com/notebook/abc123"],
      ["google-ai-studio", "Google AI Studio", "https://aistudio.google.com/app/prompts/new_chat"],
      ["github-copilot", "GitHub Copilot", "https://github.com/copilot"],
      ["microsoft-copilot", "Microsoft Copilot", "https://copilot.microsoft.com/chats/abc123"]
    ] as const;

    for (const [site, label, url] of supported) {
      expect(capturePayloadToImportBatch({
        ...payload,
        site,
        sourceId: `browser-extension-${site}`,
        sourceLabel: label,
        url
      }).sourceId).toBe(`browser-extension-${site}`);
    }
  });

  test("native validation consumes the canonical browser site contract", () => {
    expect(browserSites.map((site) => site.id)).toContain("chatgpt");
    for (const site of browserSites) {
      const host = site.hosts[0]!;
      const validPath = validPathExample(site.id);
      expect(capturePayloadToImportBatch({
        ...payload,
        site: site.id,
        sourceId: site.sourceId,
        sourceLabel: site.sourceLabel,
        url: `https://${host}${validPath}`
      }).sourceId).toBe(site.sourceId);
    }
  });

  test("rejects unsupported paths for newly supported browser capture sources", () => {
    const blocked = [
      ["perplexity", "Perplexity", "https://www.perplexity.ai/"],
      ["notebooklm", "NotebookLM", "https://notebooklm.google.com/"],
      ["google-ai-studio", "Google AI Studio", "https://aistudio.google.com/"],
      ["github-copilot", "GitHub Copilot", "https://github.com/features/copilot"],
      ["microsoft-copilot", "Microsoft Copilot", "https://copilot.microsoft.com/images/create"]
    ] as const;

    for (const [site, label, url] of blocked) {
      expect(() => capturePayloadToImportBatch({
        ...payload,
        site,
        sourceId: `browser-extension-${site}`,
        sourceLabel: label,
        url
      }), site).toThrow("not supported");
    }
  });

  test("validates native protocol payload shape at the parse boundary", () => {
    expect(() => decodeNativeMessage(new Uint8Array([1, 0, 0]))).toThrow("length prefix");
    expect(() => decodeNativeMessage(new Uint8Array([10, 0, 0, 0, 123]))).toThrow("ended before");
    expect(() => parseNativeRequest({ type: "import", protocolVersion: 1, payload: { ...payload, messages: "nope" } }))
      .toThrow("messages");
    expect(() => parseNativeRequest({
      type: "import",
      protocolVersion: 1,
      payload: { ...payload, messages: [{ ...payload.messages[0], role: "owner" }] }
    })).toThrow("role");
    expect(() => parseNativeRequest({
      type: "import",
      protocolVersion: 1,
      payload: { ...payload, updatedAt: "not-a-date" }
    })).toThrow("updatedAt");
  });

  test("parses and sanitizes native message metadata at the protocol boundary", () => {
    const parsed = parseNativeRequest({
      type: "import",
      protocolVersion: 1,
      payload: {
        ...payload,
        messages: [{
          ...payload.messages[1],
          text: "Unsafe ![inline](data:image/png;base64,secret)",
          modelId: " gpt-5 ",
          attachments: [{
            id: "attachment-1",
            name: "notes.md",
            mimeType: "text/markdown",
            sizeBytes: 42,
            url: "https://user:secret@example.com/notes.md?token=secret#frag",
            width: 640,
            height: 480,
            source: "chatgpt"
          }],
          citations: [
            { title: "Docs", url: "https://user:secret@example.com/docs?token=secret#frag", source: "chatgpt" },
            { title: "Bad", url: "javascript:alert(1)", source: "chatgpt" }
          ],
          media: [
            {
              type: "image",
              url: "https://example.com/image.png?signature=secret",
              description: "A generated chart",
              thumbnailUrl: "https://example.com/thumb.png?token=secret#frag",
              duration: "PT1M02S",
              views: 123,
              uploadedAt: "2026-01-01",
              source: "chatgpt"
            },
            { type: "video", title: "Untitled clip", source: "chatgpt" },
            { type: "image", url: "data:image/png;base64,abc", source: "chatgpt" }
          ]
        }]
      }
    });

    expect(parsed.type).toBe("import");
    if (parsed.type !== "import") return;
    expect(parsed.payload.url).toBe("https://chatgpt.com/c/conversation-1");
    expect(parsed.payload.messages[0]?.modelId).toBe("gpt-5");
    expect(parsed.payload.messages[0]?.text).toBe("Unsafe ![inline](#recallbase-image-unavailable)");
    expect(parsed.payload.messages[0]?.attachments).toEqual([{
      id: "attachment-1",
      name: "notes.md",
      mimeType: "text/markdown",
      source: "chatgpt",
      sizeBytes: 42,
      url: "https://example.com/notes.md",
      width: 640,
      height: 480
    }]);
    expect(parsed.payload.messages[0]?.citations).toEqual([{ title: "Docs", url: "https://example.com/docs", source: "chatgpt" }]);
    expect(parsed.payload.messages[0]?.media).toEqual([
      {
        type: "image",
        url: "https://example.com/image.png",
        description: "A generated chart",
        thumbnailUrl: "https://example.com/thumb.png",
        duration: "PT1M02S",
        views: 123,
        uploadedAt: "2026-01-01",
        source: "chatgpt"
      },
      { type: "video", title: "Untitled clip", source: "chatgpt" }
    ]);
  });
});

function validPathExample(siteId: string): string {
  switch (siteId) {
    case "chatgpt":
      return "/c/conversation-1";
    case "claude":
      return "/chat/conversation-1";
    case "gemini":
      return "/app/conversation-1";
    case "deepseek":
      return "/a/chat/s/conversation-1";
    case "kimi":
      return "/chat/conversation-1";
    case "qianwen":
      return "/chat/abcdef123456";
    case "doubao":
      return "/chat/conversation-1";
    case "yuanbao":
      return "/chat/app/conversation-1";
    case "grok":
      return "/chat/conversation-1";
    case "perplexity":
      return "/search/what-is-recallbase";
    case "notebooklm":
      return "/notebook/conversation-1";
    case "google-ai-studio":
      return "/app/prompts/conversation-1";
    case "github-copilot":
      return "/copilot";
    case "microsoft-copilot":
      return "/chats/conversation-1";
    default:
      throw new Error(`Missing valid path example for ${siteId}.`);
  }
}
