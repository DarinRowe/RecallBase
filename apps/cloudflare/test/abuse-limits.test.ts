import { describe, expect, test } from "bun:test";
import worker from "../src/worker/index";
import { scopedObjectKey } from "../src/auth/authorization";
import { createMemoryBackend, TEST_TOKEN_USER_A_DEVICE_A } from "../src/sync/routes";

const headers = { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_A}` };

describe("sync abuse limits", () => {
  test("rejects oversized search queries", async () => {
    const response = await worker.fetch(new Request(`https://example.test/api/search?q=${"x".repeat(121)}`, {
      headers
    }), { RECALLBASE_BACKEND: createMemoryBackend() });

    expect(response.status).toBe(400);
  });

  test("rejects oversized sync document batches before writes", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers,
      body: JSON.stringify({
        batchId: "batch_1",
        cursor: "cursor-1",
        searchDocuments: Array.from({ length: 101 }, (_, index) => ({
          id: `doc_${index}`,
          conversationId: `conv_${index}`,
          sourceId: "codex",
          title: "Too many",
          updatedAt: "2026-05-21T10:00:00.000Z",
          snippet: "Too many documents."
        })),
        encryptedRawBlobs: []
      })
    }), { RECALLBASE_BACKEND: createMemoryBackend() });

    expect(response.status).toBe(400);
  });

  test("rejects invalid search document before writing raw blobs", async () => {
    const backend = createMemoryBackend();
    const response = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers,
      body: JSON.stringify({
        batchId: "batch_2",
        cursor: "cursor-2",
        searchDocuments: [
          {
            id: "bad doc id",
            conversationId: "conv_1",
            sourceId: "codex",
            title: "Invalid",
            updatedAt: "2026-05-21T10:00:00.000Z",
            snippet: "Invalid search document."
          }
        ],
        encryptedRawBlobs: [validRawBlob("raw_1")]
      })
    }), { RECALLBASE_BACKEND: backend });

    expect(response.status).toBe(400);
    await expect(
      backend.rawBlobs.get(scopedObjectKey({ userId: "user-a", deviceId: "device-a", tokenId: "token-a" }, "raw/raw_1"))
    ).resolves.toBeUndefined();
  });

  test("rejects oversized raw blob batches before writes", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers,
      body: JSON.stringify({
        batchId: "batch_3",
        cursor: "cursor-3",
        searchDocuments: [],
        encryptedRawBlobs: Array.from({ length: 101 }, (_, index) => validRawBlob(`raw_${index}`))
      })
    }), { RECALLBASE_BACKEND: createMemoryBackend() });

    expect(response.status).toBe(400);
  });

  test("rejects oversized encrypted conversation chunk batches before writes", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers,
      body: JSON.stringify({
        batchId: "batch_4",
        cursor: "cursor-4",
        searchDocuments: [],
        encryptedConversationChunks: Array.from({ length: 101 }, (_, index) => validConversationChunk(`conv_${index}`)),
        encryptedRawBlobs: []
      })
    }), { RECALLBASE_BACKEND: createMemoryBackend() });

    expect(response.status).toBe(400);
  });

  test("rejects malformed present encrypted conversation fields", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers,
      body: JSON.stringify({
        batchId: "batch_5",
        cursor: "cursor-5",
        searchDocuments: [],
        encryptedConversationChunks: { not: "an array" },
        conversationChunkManifests: null,
        encryptedRawBlobs: []
      })
    }), { RECALLBASE_BACKEND: createMemoryBackend() });

    expect(response.status).toBe(400);
  });
});

function validRawBlob(id: string) {
  return {
    id,
    keyId: "rawkey_1",
    keyVersion: 1,
    algorithm: "AES-GCM",
    ivBase64Url: "MTIzNDU2Nzg5MDEy",
    ciphertextBase64Url: "bm90LXBsYWludGV4dA",
    contentHashBase64Url: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    encryptedAt: "2026-05-21T10:00:00.000Z"
  };
}

function validConversationChunk(conversationId: string) {
  return {
    conversationId,
    chunkId: "part_1",
    partIndex: 0,
    partCount: 1,
    messageCount: 1,
    keyId: "rawkey_1",
    keyVersion: 1,
    algorithm: "AES-GCM",
    ivBase64Url: "MTIzNDU2Nzg5MDEy",
    ciphertextBase64Url: "bm90LXBsYWludGV4dA",
    contentHashBase64Url: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    encryptedAt: "2026-05-21T10:00:00.000Z"
  };
}
