import { describe, expect, test } from "bun:test";
import { encryptConversationChunk, generateDeviceRawKey, importDeviceRawKey } from "../../../packages/core/src";
import worker from "../src/worker/index";
import { createMemoryBackend, TEST_TOKEN_USER_A_DEVICE_A, TEST_TOKEN_USER_A_DEVICE_B } from "../src/sync/routes";
import { toConversationChunkRecord } from "../src/sync/conversation-chunks";
import { toReadableSearchDocument } from "../src/sync/privacy-schema";

const auth = { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_A}` };

describe("sync worker", () => {
  test("fails closed when no persistent backend is configured", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/status"));

    expect(response.status).toBe(503);
  });

  test("commits a batch, exposes bounded search, and handles duplicate batches idempotently", async () => {
    const backend = createMemoryBackend();
    const env = { RECALLBASE_BACKEND: backend };
    const encryptedConversationChunk = await validConversationChunk();
    const body = {
      batchId: "batch_1",
      cursor: "cursor-1",
      searchDocuments: [
        {
          id: "doc_1",
          conversationId: "conv_1",
          sourceId: "codex",
          sourceLabel: "Codex",
          title: "RecallBase sync",
          updatedAt: "2026-05-21T10:00:00.000Z",
          snippet: "Batch sync uploads readable snippets only."
        }
      ],
      encryptedConversationChunks: [encryptedConversationChunk],
      conversationChunkManifests: [
        {
          conversationId: encryptedConversationChunk.conversationId,
          chunks: [
            {
              chunkId: encryptedConversationChunk.chunkId,
              partIndex: encryptedConversationChunk.partIndex,
              partCount: encryptedConversationChunk.partCount,
              messageCount: encryptedConversationChunk.messageCount,
              keyId: encryptedConversationChunk.keyId,
              keyVersion: encryptedConversationChunk.keyVersion,
              algorithm: encryptedConversationChunk.algorithm,
              contentHashBase64Url: encryptedConversationChunk.contentHashBase64Url
            }
          ]
        }
      ],
      encryptedRawBlobs: [],
      sourceStatuses: [
        {
          id: "codex",
          label: "Codex",
          health: "healthy",
          confidence: "stable",
          confidenceReason: "fixture",
          conversations: 1,
          messages: 2,
          rawEvidence: 1,
          diagnostics: []
        }
      ]
    };

    const first = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: auth,
      body: JSON.stringify(body)
    }), env);
    const duplicate = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: auth,
      body: JSON.stringify(body)
    }), env);
    const search = await worker.fetch(new Request("https://example.test/api/search?q=snippets", { headers: auth }), env);
    const conversation = await worker.fetch(new Request("https://example.test/api/conversations/conv_1", { headers: auth }), env);
    const status = await worker.fetch(new Request("https://example.test/api/status", { headers: auth }), env);

    expect(first.status).toBe(200);
    expect((await first.clone().json()).data.uploadedEncryptedConversationChunks).toBe(1);
    expect((await duplicate.json()).data.uploadedSearchDocuments).toBe(0);
    expect((await conversation.json()).data.encryptedConversationChunks).toHaveLength(1);
    expect((await search.json()).data.results).toHaveLength(1);
    expect((await status.json()).data.sources[0].label).toBe("Codex");
  });

  test("incomplete sync batches are hidden from Web search", async () => {
    const backend = createMemoryBackend();
    await backend.searchIndex.upsert([
      toReadableSearchDocument(
        {
          id: "doc_2",
          conversationId: "conv_2",
          sourceId: "codex",
          title: "Incomplete",
          updatedAt: "2026-05-21T10:00:00.000Z",
          snippet: "This should not show up yet."
        },
        { userId: "user-a", batchId: "batch_2", completed: false }
      )
    ]);

    const response = await worker.fetch(new Request("https://example.test/api/search?q=incomplete", { headers: auth }), {
      RECALLBASE_BACKEND: backend
    });

    expect((await response.json()).data.results).toHaveLength(0);
  });

  test("incomplete encrypted chunks are not returned as conversation data", async () => {
    const backend = createMemoryBackend();
    await backend.searchIndex.upsert([
      toReadableSearchDocument(
        {
          id: "doc_3",
          conversationId: "conv_3",
          sourceId: "codex",
          title: "Encrypted but pending",
          updatedAt: "2026-05-21T10:00:00.000Z",
          snippet: "Search document is complete."
        },
        { userId: "user-a", batchId: "batch_3", completed: true }
      )
    ]);
    await backend.conversationChunks.putPending([
      toConversationChunkRecord(await validConversationChunk("conv_3"), {
        userId: "user-a",
        deviceId: "device-a",
        tokenId: "token-a"
      }, "batch_3")
    ]);

    const response = await worker.fetch(new Request("https://example.test/api/conversations/conv_3", { headers: auth }), {
      RECALLBASE_BACKEND: backend
    });

    expect((await response.json()).data.encryptedConversationChunks).toHaveLength(0);
  });

  test("split conversation chunks stay hidden until the manifest batch commits", async () => {
    const backend = createMemoryBackend();
    const env = { RECALLBASE_BACKEND: backend };
    const firstPart = await validConversationChunk("conv_split", 0, 2);
    const secondPart = await validConversationChunk("conv_split", 1, 2);
    const first = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        ...syncBody("batch_split_1", "conv_split", [firstPart]),
        conversationChunkManifests: []
      })
    }), env);
    const partial = await worker.fetch(new Request("https://example.test/api/conversations/conv_split", { headers: auth }), env);
    const second = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: auth,
      body: JSON.stringify(syncBody("batch_split_2", "conv_split", [secondPart], [firstPart, secondPart]))
    }), env);
    const complete = await worker.fetch(new Request("https://example.test/api/conversations/conv_split", { headers: auth }), env);

    expect(first.status).toBe(200);
    expect((await partial.json()).data.encryptedConversationChunks).toHaveLength(0);
    expect(second.status).toBe(200);
    expect((await complete.json()).data.encryptedConversationChunks).toHaveLength(2);
  });

  test("completed but incomplete chunk sets are hidden", async () => {
    const backend = createMemoryBackend();
    await backend.searchIndex.upsert([
      toReadableSearchDocument(
        {
          id: "doc_partial_complete",
          conversationId: "conv_partial_complete",
          sourceId: "codex",
          title: "Partially completed",
          updatedAt: "2026-05-21T10:00:00.000Z",
          snippet: "Search document is complete."
        },
        { userId: "user-a", batchId: "batch_partial_complete", completed: true }
      )
    ]);
    const partialRecord = toConversationChunkRecord(await validConversationChunk("conv_partial_complete", 0, 2), {
      userId: "user-a",
      deviceId: "device-a",
      tokenId: "token-a"
    }, "batch_partial_complete");
    await backend.conversationChunks.putPending([{ ...partialRecord, completed: true }]);

    const response = await worker.fetch(new Request("https://example.test/api/conversations/conv_partial_complete", { headers: auth }), {
      RECALLBASE_BACKEND: backend
    });

    expect((await response.json()).data.encryptedConversationChunks).toHaveLength(0);
  });

  test("resyncing a smaller conversation removes stale encrypted chunks", async () => {
    const backend = createMemoryBackend();
    const env = { RECALLBASE_BACKEND: backend };
    const originalPartOne = await validConversationChunk("conv_stale", 0, 2);
    const first = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: auth,
      body: JSON.stringify(syncBody("batch_stale_1", "conv_stale", [
        originalPartOne,
        await validConversationChunk("conv_stale", 1, 2)
      ]))
    }), env);
    const second = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: auth,
      body: JSON.stringify(syncBody(
        "batch_stale_2",
        "conv_stale",
        [],
        [
          {
            chunkId: originalPartOne.chunkId,
            partIndex: 0,
            partCount: 1,
            messageCount: originalPartOne.messageCount,
            keyId: originalPartOne.keyId,
            keyVersion: originalPartOne.keyVersion,
            algorithm: originalPartOne.algorithm,
            contentHashBase64Url: originalPartOne.contentHashBase64Url
          }
        ]
      ))
    }), env);
    const conversation = await worker.fetch(new Request("https://example.test/api/conversations/conv_stale", { headers: auth }), env);
    const body = await conversation.json() as { data: { encryptedConversationChunks: Array<{ chunkId: string; partCount: number }> } };

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(body.data.encryptedConversationChunks).toEqual([{ ...body.data.encryptedConversationChunks[0], chunkId: "part_1", partCount: 1 }]);
  });

  test("same-user devices do not overwrite each other's encrypted chunks", async () => {
    const backend = createMemoryBackend();
    const env = { RECALLBASE_BACKEND: backend };
    await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: auth,
      body: JSON.stringify(syncBody("batch_device_a", "conv_shared", [await validConversationChunk("conv_shared")]))
    }), env);
    await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_B}` },
      body: JSON.stringify(syncBody("batch_device_b", "conv_shared", [await validConversationChunk("conv_shared")]))
    }), env);

    const deviceA = await worker.fetch(new Request("https://example.test/api/conversations/conv_shared", { headers: auth }), env);
    const deviceB = await worker.fetch(new Request("https://example.test/api/conversations/conv_shared", {
      headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_B}` }
    }), env);

    expect((await deviceA.json()).data.encryptedConversationChunks).toHaveLength(1);
    expect((await deviceB.json()).data.encryptedConversationChunks).toHaveLength(1);
  });
});

function syncBody(
  batchId: string,
  conversationId: string,
  encryptedConversationChunks: unknown[],
  manifestChunks?: Array<{
    chunkId: string;
    partIndex: number;
    partCount: number;
    messageCount: number;
    keyId: string;
    keyVersion: 1;
    algorithm: "AES-GCM";
    contentHashBase64Url: string;
  }>
) {
  const chunks = encryptedConversationChunks as Array<{
    chunkId: string;
    partIndex: number;
    partCount: number;
    messageCount: number;
    keyId: string;
    keyVersion: 1;
    algorithm: "AES-GCM";
    contentHashBase64Url: string;
  }>;
  return {
    batchId,
    cursor: batchId,
    searchDocuments: [
      {
        id: `doc_${conversationId}`,
        conversationId,
        sourceId: "codex",
        title: "Resynced encrypted conversation",
        updatedAt: "2026-05-21T10:00:00.000Z",
        snippet: "Readable snippet."
      }
    ],
    encryptedConversationChunks,
    conversationChunkManifests: [
      {
        conversationId,
        chunks: (manifestChunks ?? chunks).map((chunk) => ({
          chunkId: chunk.chunkId,
          partIndex: chunk.partIndex,
          partCount: chunk.partCount,
          messageCount: chunk.messageCount,
          keyId: chunk.keyId,
          keyVersion: chunk.keyVersion,
          algorithm: chunk.algorithm,
          contentHashBase64Url: chunk.contentHashBase64Url
        }))
      }
    ],
    encryptedRawBlobs: []
  };
}

async function validConversationChunk(conversationId = "conv_1", partIndex = 0, partCount = 1) {
  const key = await generateDeviceRawKey(new Date("2026-05-21T10:00:00.000Z"));
  const imported = await importDeviceRawKey(key);
  return encryptConversationChunk(
    {
      conversationId,
      chunkId: `part_${partIndex + 1}`,
      partIndex,
      partCount,
      messages: [
        {
          id: "msg_1",
          role: "assistant",
          createdAt: "2026-05-21T10:00:00.000Z",
          text: "Cloudflare should never read this plaintext."
        }
      ]
    },
    imported,
    new Date("2026-05-21T10:01:00.000Z")
  );
}
