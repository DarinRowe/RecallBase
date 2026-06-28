import type { DeviceKeyResult, EncryptedConversationChunk, MessageDetail } from "@recallbase/contracts";
import { decryptConversationChunk, importDeviceRawKey } from "@recallbase/core";

export type ImportedDeviceKey = DeviceKeyResult & { rawKeyBase64Url: string };

export async function decryptConversationMessages(
  chunks: EncryptedConversationChunk[],
  deviceKey: ImportedDeviceKey
): Promise<MessageDetail[]> {
  if (chunks.length === 0) return [];
  const ordered = [...chunks].sort((left, right) => left.partIndex - right.partIndex);
  const expectedPartCount = ordered[0]?.partCount ?? 0;
  if (ordered.length !== expectedPartCount) throw new Error("Encrypted conversation is incomplete.");

  const rawKey = await importDeviceRawKey({
    id: deviceKey.id,
    version: 1,
    algorithm: "AES-GCM",
    extractable: true,
    createdAt: deviceKey.createdAt,
    rawKeyBase64Url: deviceKey.rawKeyBase64Url
  });
  const messages: MessageDetail[] = [];

  for (const [index, chunk] of ordered.entries()) {
    if (chunk.partIndex !== index || chunk.partCount !== expectedPartCount) {
      throw new Error("Encrypted conversation chunk order is invalid.");
    }
    const plaintext = await decryptConversationChunk(chunk, rawKey);
    messages.push(...plaintext.messages);
  }

  return messages;
}
