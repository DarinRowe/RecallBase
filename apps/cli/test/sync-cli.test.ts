import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDatabase } from "@recallbase/core";
import worker from "../../cloudflare/src/worker/index";
import { createMemoryBackend, TEST_TOKEN_USER_A_DEVICE_A } from "../../cloudflare/src/sync/routes";
import { runCommand } from "../src/cli";

function paths() {
  const dir = mkdtempSync(join(tmpdir(), "rb-sync-cli-"));
  return {
    dbPath: join(dir, "db.sqlite"),
    authPath: join(dir, "auth.json"),
    keyPath: join(dir, "device-key.json")
  };
}

function seedDb(path: string): void {
  const db = new LocalDatabase(path);
  db.importBatch({
    sourceId: "codex",
    sourceLabel: "Codex",
    confidence: "stable",
    confidenceReason: "fixture",
    conversations: [
      {
        sourceId: "codex",
        sourceLabel: "Codex",
        upstreamId: "sync-cli",
        title: "CLI sync",
        startedAt: "2026-05-21T14:00:00.000Z",
        updatedAt: "2026-05-21T14:00:00.000Z",
        rawEvidence: [],
        messages: [{ role: "assistant", createdAt: "2026-05-21T14:00:00.000Z", text: "Sync CLI fixture." }]
      }
    ]
  });
  db.close();
}

describe("CLI sync", () => {
  test("sync without login returns auth_required", async () => {
    const { dbPath, authPath } = paths();
    const result = await runCommand(["sync", "--json", "--db", dbPath, "--auth-path", authPath]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("auth_required");
  });

  test("login stores an explicit token and sync uploads search documents", async () => {
    const { dbPath, authPath, keyPath } = paths();
    seedDb(dbPath);
    const backend = createMemoryBackend();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input, init) => worker.fetch(new Request(input, init), { RECALLBASE_BACKEND: backend })) as typeof fetch;

    try {
      const login = await runCommand(["login", "--json", "--token", TEST_TOKEN_USER_A_DEVICE_A, "--auth-path", authPath]);
      const status = await runCommand(["sync", "status", "--json", "--db", dbPath, "--auth-path", authPath]);
      const sync = await runCommand([
        "sync",
        "--json",
        "--db",
        dbPath,
        "--auth-path",
        authPath,
        "--device-key-path",
        keyPath,
        "--sync-url",
        "https://example.test"
      ]);
      const search = await fetch("https://example.test/api/search?q=CLI", {
        headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_A}` }
      });
      const searchBody = await search.json() as { data: { results: Array<{ conversationId: string }> } };
      const conversation = await fetch(`https://example.test/api/conversations/${searchBody.data.results[0]!.conversationId}`, {
        headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_A}` }
      });
      const conversationBody = await conversation.json() as { data: { encryptedConversationChunks: unknown[] } };
      const syncBody = JSON.parse(sync.stdout);

      expect(JSON.parse(login.stdout).data.state).toBe("succeeded");
      expect(JSON.parse(status.stdout).data.mode).toBe("hybrid_private");
      expect(syncBody.data.uploadedSearchDocuments).toBe(1);
      expect(syncBody.data.uploadedEncryptedConversationChunks).toBe(1);
      expect(syncBody.data.uploadedEncryptedRawBlobs).toBe(0);
      expect(conversationBody.data.encryptedConversationChunks).toHaveLength(1);
      expect(JSON.stringify(conversationBody.data.encryptedConversationChunks)).not.toContain("Sync CLI fixture.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("unchanged sync skips remote writes and force resync uploads again", async () => {
    const { dbPath, authPath, keyPath } = paths();
    seedDb(dbPath);
    const backend = createMemoryBackend();
    const originalFetch = globalThis.fetch;
    let syncRequests = 0;
    globalThis.fetch = ((input, init) => {
      if (String(input).includes("/api/sync/batches")) syncRequests += 1;
      return worker.fetch(new Request(input, init), { RECALLBASE_BACKEND: backend });
    }) as typeof fetch;

    try {
      await runCommand(["login", "--json", "--token", TEST_TOKEN_USER_A_DEVICE_A, "--auth-path", authPath]);
      const baseArgs = [
        "sync",
        "--json",
        "--db",
        dbPath,
        "--auth-path",
        authPath,
        "--device-key-path",
        keyPath,
        "--sync-url",
        "https://example.test"
      ];
      const first = JSON.parse((await runCommand(baseArgs)).stdout);
      const second = JSON.parse((await runCommand(baseArgs)).stdout);
      const status = JSON.parse((await runCommand(["sync", "status", "--json", "--db", dbPath, "--auth-path", authPath, "--device-key-path", keyPath, "--sync-url", "https://example.test"])).stdout);
      const forced = JSON.parse((await runCommand([...baseArgs, "--force"])).stdout);

      expect(first.data.uploadedSearchDocuments).toBe(1);
      expect(first.data.uploadedEncryptedConversationChunks).toBe(1);
      expect(second.data.uploadedSearchDocuments).toBe(0);
      expect(second.data.uploadedEncryptedConversationChunks).toBe(0);
      expect(status.data.pendingLocalChanges).toBe(0);
      expect(forced.data.uploadedSearchDocuments).toBe(1);
      expect(forced.data.uploadedEncryptedConversationChunks).toBe(1);
      expect(syncRequests).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("old sync service response does not mark encrypted chunks as synced", async () => {
    const { dbPath, authPath, keyPath } = paths();
    seedDb(dbPath);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ok: true,
      data: {
        loggedIn: true,
        mode: "hybrid_private",
        pendingLocalChanges: 0,
        rawDecryptionAvailable: false,
        readableSurface: ["metadata", "snippet", "optional_summary"],
        uploadedSearchDocuments: 1,
        uploadedEncryptedRawBlobs: 0
      }
    }), { headers: { "content-type": "application/json" } })) as typeof fetch;

    try {
      await runCommand(["login", "--json", "--token", TEST_TOKEN_USER_A_DEVICE_A, "--auth-path", authPath]);
      const failed = await runCommand([
        "sync",
        "--json",
        "--db",
        dbPath,
        "--auth-path",
        authPath,
        "--device-key-path",
        keyPath,
        "--sync-url",
        "https://old.example.test"
      ]);

      expect(failed.code).toBe(1);
      expect(JSON.parse(failed.stdout).error.message).toContain("does not support encrypted conversation chunks");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("large changed conversations split across multiple sync batches", async () => {
    const { dbPath, authPath, keyPath } = paths();
    const db = new LocalDatabase(dbPath);
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      confidence: "stable",
      confidenceReason: "fixture",
      conversations: [
        {
          sourceId: "codex",
          sourceLabel: "Codex",
          upstreamId: "large-sync-cli",
          title: "Large CLI sync",
          startedAt: "2026-05-21T14:00:00.000Z",
          updatedAt: "2026-05-21T14:00:00.000Z",
          rawEvidence: [],
          messages: Array.from({ length: 6 }, (_, index) => ({
            role: "assistant" as const,
            createdAt: `2026-05-21T14:0${index}:00.000Z`,
            text: `${index} ${"x".repeat(390 * 1024)}`
          }))
        }
      ]
    });
    db.close();
    const backend = createMemoryBackend();
    const originalFetch = globalThis.fetch;
    let syncRequests = 0;
    globalThis.fetch = ((input, init) => {
      if (String(input).includes("/api/sync/batches")) syncRequests += 1;
      return worker.fetch(new Request(input, init), { RECALLBASE_BACKEND: backend });
    }) as typeof fetch;

    try {
      await runCommand(["login", "--json", "--token", TEST_TOKEN_USER_A_DEVICE_A, "--auth-path", authPath]);
      const result = await runCommand([
        "sync",
        "--json",
        "--db",
        dbPath,
        "--auth-path",
        authPath,
        "--device-key-path",
        keyPath,
        "--sync-url",
        "https://example.test"
      ]);

      expect(result.code).toBe(0);
      expect(syncRequests).toBeGreaterThan(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("key show and export use metadata-safe JSON and restrictive file permissions", async () => {
    const { dbPath, keyPath } = paths();
    const show = await runCommand(["key", "show", "--json", "--db", dbPath, "--device-key-path", keyPath]);
    const exported = await runCommand(["key", "export", "--json", "--db", dbPath, "--device-key-path", keyPath]);
    const showBody = JSON.parse(show.stdout);
    const exportBody = JSON.parse(exported.stdout);

    expect(showBody.data.path).toBe(keyPath);
    expect(showBody.data.rawKeyBase64Url).toBeUndefined();
    expect(typeof exportBody.data.rawKeyBase64Url).toBe("string");
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
  });

  test("hosted login unavailable returns concise auth failure", async () => {
    const result = await runCommand(["login", "--json"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("auth_failed");
  });
});
