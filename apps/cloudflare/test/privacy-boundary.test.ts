import { describe, expect, test } from "bun:test";
import { conversationChunkPlaintextDigest, encryptConversationChunk } from "../../../packages/core/src/crypto/conversation-encryption";
import { generateDeviceRawKey, importDeviceRawKey } from "../../../packages/core/src/crypto/key-management";
import { encryptRawEvidence } from "../../../packages/core/src/crypto/raw-encryption";
import worker from "../src/worker/index";
import { createMemoryBackend, TEST_TOKEN_USER_A_DEVICE_A } from "../src/sync/routes";
import { toReadableSearchDocument } from "../src/sync/privacy-schema";

describe("sync privacy boundary", () => {
  test("readable search documents are bounded and redact secret-like tokens", () => {
    const document = toReadableSearchDocument(
      {
        id: "doc_1",
        conversationId: "conv_1",
        sourceId: "codex",
        title: "Deploy token",
        updatedAt: "2026-05-21T10:00:00.000Z",
        snippet: `Use api_token="sk-proj-${"a".repeat(32)}" and sk-ant-api03-${"c".repeat(32)}. ${"x".repeat(400)}`,
        optionalSummary: `GitHub token github_pat_${"b".repeat(32)} and AWS key AKIA${"D".repeat(16)} were discussed.`
      },
      { userId: "user-a", batchId: "batch_1", completed: true }
    );

    expect(document.snippet.length).toBeLessThanOrEqual(280);
    expect(document.snippet).not.toContain("sk-proj-");
    expect(document.snippet).not.toContain("sk-ant-api03-");
    expect(document.optionalSummary).not.toContain("github_pat_");
    expect(document.optionalSummary).not.toContain("AKIA");
  });

  test("encrypted raw evidence is not backend-readable plaintext", async () => {
    const deviceKey = await generateDeviceRawKey(new Date("2026-05-21T10:00:00.000Z"));
    const imported = await importDeviceRawKey(deviceKey);
    const plaintext = "full transcript with private implementation details";

    const blob = await encryptRawEvidence({ id: "raw_1", plaintext }, imported);

    expect(blob.ciphertextBase64Url).not.toContain(plaintext);
    expect(JSON.stringify(blob)).not.toContain("private implementation details");
    expect(blob.keyId).toBe(deviceKey.id);
  });

  test("encrypted conversation metadata does not expose plaintext hashes", async () => {
    const deviceKey = await generateDeviceRawKey(new Date("2026-05-21T10:00:00.000Z"));
    const imported = await importDeviceRawKey(deviceKey);
    const chunkInput = {
      conversationId: "conv_1",
      chunkId: "part_1",
      partIndex: 0,
      partCount: 1,
      messages: [
        {
          id: "msg_1",
          role: "assistant" as const,
          createdAt: "2026-05-21T10:00:00.000Z",
          text: "full transcript with private implementation details"
        }
      ]
    };

    const digest = await conversationChunkPlaintextDigest(chunkInput);
    const encrypted = await encryptConversationChunk(chunkInput, imported);

    expect(JSON.stringify(encrypted)).not.toContain(digest.plaintextHashBase64Url);
    expect(encrypted.contentHashBase64Url).not.toBe(digest.plaintextHashBase64Url);
  });

  test("hosted sync rejects raw evidence uploads before writing counters", async () => {
    const backend = createMemoryBackend();
    const response = await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_A}` },
      body: JSON.stringify({
        batchId: "batch_raw_boundary",
        cursor: "cursor-raw-boundary",
        searchDocuments: [],
        encryptedRawBlobs: [
          {
            id: "raw_1",
            keyId: "rawkey_1",
            keyVersion: 1,
            algorithm: "AES-GCM",
            ivBase64Url: "MTIzNDU2Nzg5MDEy",
            ciphertextBase64Url: "bm90LXBsYWludGV4dA",
            contentHashBase64Url: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            encryptedAt: "2026-05-21T10:00:00.000Z"
          }
        ]
      })
    }), { RECALLBASE_BACKEND: backend });

    const body = await response.json() as { error: { code: string; message: string } };
    const status = await worker.fetch(new Request("https://example.test/api/status", {
      headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_A}` }
    }), { RECALLBASE_BACKEND: backend });
    const statusBody = await status.json() as { data: { sync: { uploadedEncryptedRawBlobs?: number } } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("privacy_violation");
    expect(JSON.stringify(statusBody)).not.toContain("uploadedEncryptedRawBlobs");
  });
});
