import type {
  ConversationChunkPlaintext,
  EncryptedConversationChunkInput,
  MessageDetail
} from "@recallbase/contracts";
import type { ImportedRawKey } from "./key-management";
import { fromBase64Url, toArrayBuffer, toBase64Url } from "./key-management";

export const DEFAULT_CONVERSATION_CHUNK_PLAINTEXT_BYTES = 128 * 1024;

export interface ConversationChunkPlaintextDigest {
  chunkId: string;
  partIndex: number;
  partCount: number;
  messageCount: number;
  plaintextHashBase64Url: string;
  plaintextBytes: Uint8Array;
}

export async function encryptConversationChunk(
  input: {
    conversationId: string;
    chunkId: string;
    partIndex: number;
    partCount: number;
    messages: MessageDetail[];
  },
  rawKey: ImportedRawKey,
  now = new Date()
): Promise<EncryptedConversationChunkInput> {
  const digest = await conversationChunkPlaintextDigest(input);
  const encodedPlaintext = digest.plaintextBytes;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = conversationAdditionalData(input.conversationId, input.chunkId);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(additionalData) },
      rawKey.key,
      toArrayBuffer(encodedPlaintext)
    )
  );
  const ciphertextHash = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(ciphertext)));

  return {
    conversationId: input.conversationId,
    chunkId: input.chunkId,
    partIndex: input.partIndex,
    partCount: input.partCount,
    messageCount: digest.messageCount,
    keyId: rawKey.id,
    keyVersion: 1,
    algorithm: "AES-GCM",
    ivBase64Url: toBase64Url(iv),
    ciphertextBase64Url: toBase64Url(ciphertext),
    contentHashBase64Url: toBase64Url(ciphertextHash),
    encryptedAt: now.toISOString()
  };
}

export async function conversationChunkPlaintextDigest(input: {
  conversationId: string;
  chunkId: string;
  partIndex: number;
  partCount: number;
  messages: MessageDetail[];
}): Promise<ConversationChunkPlaintextDigest> {
  const plaintext: ConversationChunkPlaintext = {
    schemaVersion: 1,
    conversationId: input.conversationId,
    messages: input.messages
  };
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(plaintext));
  const plaintextHash = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(plaintextBytes)));
  return {
    chunkId: input.chunkId,
    partIndex: input.partIndex,
    partCount: input.partCount,
    messageCount: input.messages.length,
    plaintextHashBase64Url: toBase64Url(plaintextHash),
    plaintextBytes
  };
}

export async function decryptConversationChunk(
  chunk: EncryptedConversationChunkInput,
  rawKey: ImportedRawKey
): Promise<ConversationChunkPlaintext> {
  if (chunk.keyId !== rawKey.id) {
    throw new Error("Conversation chunk was encrypted with a different device-local key.");
  }

  const ciphertextBytes = fromBase64Url(chunk.ciphertextBase64Url);
  const contentHash = toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(ciphertextBytes))));
  if (contentHash !== chunk.contentHashBase64Url) {
    throw new Error("Conversation chunk content hash does not match ciphertext.");
  }

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64Url(chunk.ivBase64Url)),
      additionalData: toArrayBuffer(conversationAdditionalData(chunk.conversationId, chunk.chunkId))
    },
    rawKey.key,
    toArrayBuffer(ciphertextBytes)
  );

  const plaintextBytes = new Uint8Array(plaintext);
  const parsed = JSON.parse(new TextDecoder().decode(plaintextBytes)) as ConversationChunkPlaintext;
  if (parsed.schemaVersion !== 1 || parsed.conversationId !== chunk.conversationId) {
    throw new Error("Conversation chunk plaintext metadata does not match encrypted metadata.");
  }
  return parsed;
}

export function chunkConversationMessages(
  conversationId: string,
  messages: MessageDetail[],
  maxPlaintextBytes = DEFAULT_CONVERSATION_CHUNK_PLAINTEXT_BYTES
): Array<{ conversationId: string; chunkId: string; partIndex: number; partCount: number; messages: MessageDetail[] }> {
  const chunks: MessageDetail[][] = [];
  let current: MessageDetail[] = [];

  for (const message of messages) {
    const candidate = [...current, message];
    if (current.length > 0 && plaintextBytes(conversationId, candidate) > maxPlaintextBytes) {
      chunks.push(current);
      current = [message];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0 || messages.length === 0) chunks.push(current);

  return chunks.map((chunk, index) => ({
    conversationId,
    chunkId: `part_${index + 1}`,
    partIndex: index,
    partCount: chunks.length,
    messages: chunk
  }));
}

function plaintextBytes(conversationId: string, messages: MessageDetail[]): number {
  return new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, conversationId, messages })).byteLength;
}

function conversationAdditionalData(conversationId: string, chunkId: string): Uint8Array {
  return new TextEncoder().encode(`${conversationId}:${chunkId}`);
}
