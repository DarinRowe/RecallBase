import { describe, expect, test } from "bun:test";
import worker from "../src/worker/index";
import {
  createMemoryBackend,
  TEST_TOKEN_USER_A_DEVICE_A,
  TEST_TOKEN_USER_A_DEVICE_B,
  TEST_TOKEN_USER_B_DEVICE_B
} from "../src/sync/routes";

describe("sync authorization", () => {
  test("rejects missing auth", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/search?q=sync"), {
      RECALLBASE_BACKEND: createMemoryBackend()
    });

    expect(response.status).toBe(401);
  });

  test("derives user scope from auth instead of client-supplied ids", async () => {
    const backend = createMemoryBackend();
    const env = { RECALLBASE_BACKEND: backend };
    await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_A}` },
      body: JSON.stringify({
        batchId: "batch_1",
        cursor: "cursor-1",
        searchDocuments: [
          {
            id: "doc_1",
            conversationId: "conv_1",
            sourceId: "codex",
            title: "Private user A sync",
            updatedAt: "2026-05-21T10:00:00.000Z",
            snippet: "Only user A can see this."
          }
        ],
        encryptedRawBlobs: []
      })
    }), env);

    const userBSearch = await worker.fetch(new Request("https://example.test/api/search?q=private", {
      headers: { authorization: `Bearer ${TEST_TOKEN_USER_B_DEVICE_B}` }
    }), env);
    const userBOpen = await worker.fetch(new Request("https://example.test/api/conversations/conv_1", {
      headers: { authorization: `Bearer ${TEST_TOKEN_USER_B_DEVICE_B}` }
    }), env);

    expect((await userBSearch.json()).data.results).toHaveLength(0);
    expect(userBOpen.status).toBe(404);
  });

  test("rejects fabricated self-describing bearer tokens", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/search?q=sync", {
      headers: { authorization: "Bearer user:user-a:device:device-a" }
    }), { RECALLBASE_BACKEND: createMemoryBackend() });

    expect(response.status).toBe(401);
  });

  test("keeps sync cursors isolated by device", async () => {
    const backend = createMemoryBackend();
    const env = { RECALLBASE_BACKEND: backend };
    await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_A}` },
      body: JSON.stringify({
        batchId: "batch_1",
        cursor: "cursor-device-a",
        searchDocuments: [],
        encryptedRawBlobs: []
      })
    }), env);

    const deviceBStatus = await worker.fetch(new Request("https://example.test/api/sync/status", {
      headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_B}` }
    }), env);

    expect((await deviceBStatus.json()).data.remoteCursor).toBeUndefined();
  });

  test("shares readable metadata across same-user devices", async () => {
    const backend = createMemoryBackend();
    const env = { RECALLBASE_BACKEND: backend };
    await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_A}` },
      body: JSON.stringify({
        batchId: "batch_metadata",
        cursor: "cursor-metadata",
        searchDocuments: [
          {
            id: "doc_metadata",
            conversationId: "conv_metadata",
            sourceId: "codex",
            title: "Shared readable metadata",
            updatedAt: "2026-05-21T10:00:00.000Z",
            snippet: "Same-user devices can search readable snippets."
          }
        ],
        encryptedRawBlobs: []
      })
    }), env);

    const deviceBSearch = await worker.fetch(new Request("https://example.test/api/search?q=readable", {
      headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_B}` }
    }), env);

    expect((await deviceBSearch.json()).data.results).toHaveLength(1);
  });
});
