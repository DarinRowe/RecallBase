import { describe, expect, test } from "bun:test";
import { chunkConversationMessages, decryptConversationChunk, encryptConversationChunk } from "../src/crypto/conversation-encryption";
import { generateDeviceRawKey, importDeviceRawKey } from "../src/crypto/key-management";
import type { MessageDetail } from "@recallbase/contracts";

describe("conversation encryption", () => {
  test("roundtrips encrypted conversation chunks without exposing plaintext", async () => {
    const key = await importDeviceRawKey(await generateDeviceRawKey(new Date("2026-05-21T10:00:00.000Z")));
    const messages: MessageDetail[] = [
      { id: "msg_1", role: "user", createdAt: "2026-05-21T10:00:00.000Z", text: "private conversation text" },
      { id: "msg_2", role: "assistant", createdAt: "2026-05-21T10:01:00.000Z", text: "answer text" }
    ];
    const [chunk] = chunkConversationMessages("conv_1", messages);
    const encrypted = await encryptConversationChunk(chunk!, key, new Date("2026-05-21T10:02:00.000Z"));
    const serialized = JSON.stringify(encrypted);

    expect(serialized).not.toContain("private conversation text");
    expect(serialized).not.toContain("answer text");
    expect(await decryptConversationChunk(encrypted, key)).toEqual({
      schemaVersion: 1,
      conversationId: "conv_1",
      messages
    });
  });

  test("wrong key fails decryption", async () => {
    const key = await importDeviceRawKey(await generateDeviceRawKey());
    const wrongKey = await importDeviceRawKey(await generateDeviceRawKey());
    const [chunk] = chunkConversationMessages("conv_1", [
      { id: "msg_1", role: "user", createdAt: "2026-05-21T10:00:00.000Z", text: "secret" }
    ]);
    const encrypted = await encryptConversationChunk(chunk!, key);

    await expect(decryptConversationChunk(encrypted, wrongKey)).rejects.toThrow("different device-local key");
  });

  test("content hash mismatch fails decryption", async () => {
    const key = await importDeviceRawKey(await generateDeviceRawKey());
    const [chunk] = chunkConversationMessages("conv_1", [
      { id: "msg_1", role: "assistant", createdAt: "2026-05-21T10:00:00.000Z", text: "hash checked" }
    ]);
    const encrypted = await encryptConversationChunk(chunk!, key);

    await expect(decryptConversationChunk({
      ...encrypted,
      contentHashBase64Url: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    }, key)).rejects.toThrow("content hash");
  });

  test("chunking preserves message order", () => {
    const messages = Array.from({ length: 5 }, (_, index): MessageDetail => ({
      id: `msg_${index}`,
      role: "user",
      createdAt: "2026-05-21T10:00:00.000Z",
      text: `message ${index} ${"x".repeat(30)}`
    }));
    const chunks = chunkConversationMessages("conv_1", messages, 190);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((chunk) => chunk.messages)).toEqual(messages);
    expect(chunks.map((chunk) => chunk.partIndex)).toEqual(chunks.map((_, index) => index));
    expect(chunks.every((chunk) => chunk.partCount === chunks.length)).toBe(true);
  });
});
