import type {
  ConversationChunkManifestInput,
  ConversationChunkManifestPart,
  EncryptedConversationChunk,
  EncryptedConversationAvailability,
  EncryptedConversationChunkInput
} from "@recallbase/contracts";
import type { AuthSubject } from "../auth/authorization";
import { scopedObjectKey } from "../auth/authorization";
import { MAX_ENCRYPTED_BLOB_BYTES, assertId } from "./privacy-schema";

export const MAX_CONVERSATION_CHUNKS_PER_BATCH = 100;
const MAX_TOTAL_ENCRYPTED_CONVERSATION_BYTES = 5 * 1024 * 1024;

export interface EncryptedConversationChunkRecord extends EncryptedConversationChunk {
  userId: string;
  deviceId: string;
  batchId: string;
  completed: boolean;
}

export interface ConversationChunkStore {
  putPending(records: EncryptedConversationChunkRecord[]): Promise<void>;
  completeBatch(
    subject: AuthSubject,
    batchId: string,
    records: EncryptedConversationChunkRecord[],
    manifests: ConversationChunkManifestInput[]
  ): Promise<void>;
  listCompleted(subject: AuthSubject, conversationId: string): Promise<EncryptedConversationChunk[]>;
  listAvailability(subject: AuthSubject, conversationId: string): Promise<EncryptedConversationAvailability[]>;
}

export class MemoryConversationChunkStore implements ConversationChunkStore {
  private readonly records = new Map<string, EncryptedConversationChunkRecord>();

  async putPending(records: EncryptedConversationChunkRecord[]): Promise<void> {
    for (const record of records) {
      this.records.set(memoryKey(record), record);
    }
  }

  async completeBatch(
    subject: AuthSubject,
    _batchId: string,
    _records: EncryptedConversationChunkRecord[],
    manifests: ConversationChunkManifestInput[]
  ): Promise<void> {
    for (const manifest of manifests) {
      const currentChunkIds = new Set(manifest.chunks.map((chunk) => chunk.chunkId));
      for (const [key, record] of this.records) {
        if (
          record.userId === subject.userId &&
          record.deviceId === subject.deviceId &&
          record.conversationId === manifest.conversationId
        ) {
          const manifestPart = manifest.chunks.find((chunk) => chunk.chunkId === record.chunkId);
          if (!manifestPart || !currentChunkIds.has(record.chunkId)) {
            this.records.delete(key);
          } else {
            this.records.set(key, { ...record, ...manifestPart, completed: true });
          }
        }
      }
    }
  }

  async listCompleted(subject: AuthSubject, conversationId: string): Promise<EncryptedConversationChunk[]> {
    const chunks = [...this.records.values()]
      .filter(
        (record) =>
          record.userId === subject.userId &&
          record.deviceId === subject.deviceId &&
          record.conversationId === conversationId &&
          record.completed
      )
      .sort((left, right) => left.partIndex - right.partIndex)
      .map(toPublicChunk);
    return completeChunkSet(chunks);
  }

  async listAvailability(subject: AuthSubject, conversationId: string): Promise<EncryptedConversationAvailability[]> {
    const groups = new Map<string, EncryptedConversationAvailability>();
    for (const record of this.records.values()) {
      if (record.userId !== subject.userId || record.conversationId !== conversationId || !record.completed) continue;
      const key = `${record.deviceId}:${record.keyId}`;
      const existing = groups.get(key);
      groups.set(key, {
        deviceId: record.deviceId,
        keyId: record.keyId,
        chunkCount: (existing?.chunkCount ?? 0) + 1,
        messageCount: (existing?.messageCount ?? 0) + record.messageCount,
        encryptedAt: maxIso(existing?.encryptedAt, record.encryptedAt)
      });
    }
    return [...groups.values()].sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  }
}

function memoryKey(record: Pick<EncryptedConversationChunkRecord, "userId" | "deviceId" | "conversationId" | "chunkId">): string {
  return `${record.userId}:${record.deviceId}:${record.conversationId}:${record.chunkId}`;
}

export function toConversationChunkRecord(
  chunk: EncryptedConversationChunkInput,
  subject: AuthSubject,
  batchId: string
): EncryptedConversationChunkRecord {
  const validated = validateConversationChunkInput(chunk);
  return {
    ...validated,
    objectKey: scopedObjectKey(subject, `conversations/${validated.conversationId}/${validated.chunkId}`),
    userId: subject.userId,
    deviceId: subject.deviceId,
    batchId,
    completed: false
  };
}

export function validateConversationChunkManifestInput(manifest: unknown): ConversationChunkManifestInput {
  if (!isRecord(manifest)) throw new Error("Conversation chunk manifest must be an object.");
  const conversationId = readString(manifest, "conversationId");
  assertId(conversationId, "conversation id");
  const chunks = readArray(manifest, "chunks").map((chunk) => validateConversationChunkManifestPart(chunk));
  for (const chunk of chunks) {
    if (chunk.partCount !== chunks.length) throw new Error("Conversation chunk manifest part count does not match chunk count.");
  }
  return { conversationId, chunks };
}

function validateConversationChunkManifestPart(part: unknown): ConversationChunkManifestPart {
  if (!isRecord(part)) throw new Error("Conversation chunk manifest part must be an object.");
  const chunkId = readString(part, "chunkId");
  const keyId = readString(part, "keyId");
  const contentHashBase64Url = readString(part, "contentHashBase64Url");
  const partIndex = readInteger(part, "partIndex");
  const partCount = readInteger(part, "partCount");
  const messageCount = readInteger(part, "messageCount");
  assertId(chunkId, "conversation chunk id");
  assertId(keyId, "conversation key id");
  if (part.algorithm !== "AES-GCM" || part.keyVersion !== 1) {
    throw new Error("Unsupported conversation chunk manifest encryption metadata.");
  }
  if (partIndex < 0 || partCount < 1 || partIndex >= partCount) {
    throw new Error("Invalid conversation chunk manifest part metadata.");
  }
  if (messageCount < 0) throw new Error("Invalid conversation chunk manifest message count.");
  if (decodedBase64UrlLength(contentHashBase64Url, "conversation chunk content hash") !== 32) {
    throw new Error("Conversation chunk content hash must be 32 bytes.");
  }
  return {
    chunkId,
    partIndex,
    partCount,
    messageCount,
    keyId,
    keyVersion: 1,
    algorithm: "AES-GCM",
    contentHashBase64Url
  };
}

export function validateConversationChunkInput(chunk: unknown): EncryptedConversationChunkInput {
  if (!isRecord(chunk)) throw new Error("Encrypted conversation chunk must be an object.");
  const conversationId = readString(chunk, "conversationId");
  const chunkId = readString(chunk, "chunkId");
  const keyId = readString(chunk, "keyId");
  const ivBase64Url = readString(chunk, "ivBase64Url");
  const ciphertextBase64Url = readString(chunk, "ciphertextBase64Url");
  const contentHashBase64Url = readString(chunk, "contentHashBase64Url");
  const encryptedAt = readString(chunk, "encryptedAt");
  const partIndex = readInteger(chunk, "partIndex");
  const partCount = readInteger(chunk, "partCount");
  const messageCount = readInteger(chunk, "messageCount");
  assertId(conversationId, "conversation id");
  assertId(chunkId, "conversation chunk id");
  assertId(keyId, "conversation key id");
  if (chunk.algorithm !== "AES-GCM" || chunk.keyVersion !== 1) {
    throw new Error("Unsupported conversation chunk encryption metadata.");
  }
  if (partIndex < 0 || partCount < 1 || partIndex >= partCount) {
    throw new Error("Invalid conversation chunk part metadata.");
  }
  if (messageCount < 0) throw new Error("Invalid conversation chunk message count.");
  assertIsoDate(encryptedAt, "encryptedAt");
  if (decodedBase64UrlLength(ivBase64Url, "conversation chunk iv") !== 12) {
    throw new Error("Conversation chunk IV must be 12 bytes.");
  }
  if (decodedBase64UrlLength(contentHashBase64Url, "conversation chunk content hash") !== 32) {
    throw new Error("Conversation chunk content hash must be 32 bytes.");
  }
  if (decodedBase64UrlLength(ciphertextBase64Url, "conversation chunk ciphertext") > MAX_ENCRYPTED_BLOB_BYTES) {
    throw new Error("Encrypted conversation chunk is too large.");
  }
  return {
    conversationId,
    chunkId,
    partIndex,
    partCount,
    messageCount,
    keyId,
    keyVersion: 1,
    algorithm: "AES-GCM",
    ivBase64Url,
    ciphertextBase64Url,
    contentHashBase64Url,
    encryptedAt
  };
}

export function validateConversationChunkTotals(chunks: EncryptedConversationChunkInput[]): void {
  const total = chunks.reduce(
    (sum, chunk) => sum + decodedBase64UrlLength(chunk.ciphertextBase64Url, "conversation chunk ciphertext"),
    0
  );
  if (total > MAX_TOTAL_ENCRYPTED_CONVERSATION_BYTES) throw new Error("Encrypted conversation chunk batch is too large.");
}

function toPublicChunk(record: EncryptedConversationChunkRecord): EncryptedConversationChunk {
  return {
    conversationId: record.conversationId,
    chunkId: record.chunkId,
    partIndex: record.partIndex,
    partCount: record.partCount,
    messageCount: record.messageCount,
    keyId: record.keyId,
    keyVersion: record.keyVersion,
    algorithm: record.algorithm,
    ivBase64Url: record.ivBase64Url,
    ciphertextBase64Url: record.ciphertextBase64Url,
    contentHashBase64Url: record.contentHashBase64Url,
    encryptedAt: record.encryptedAt,
    objectKey: record.objectKey
  };
}

export function completeChunkSet(chunks: EncryptedConversationChunk[]): EncryptedConversationChunk[] {
  if (chunks.length === 0) return [];
  const partCount = chunks[0]!.partCount;
  if (chunks.length !== partCount) return [];
  const indexes = new Set<number>();
  for (const chunk of chunks) {
    if (chunk.partCount !== partCount || chunk.partIndex < 0 || chunk.partIndex >= partCount) return [];
    indexes.add(chunk.partIndex);
  }
  if (indexes.size !== partCount) return [];
  return chunks;
}

function maxIso(left: string | undefined, right: string): string {
  return !left || Date.parse(right) > Date.parse(left) ? right : left;
}

function decodedBase64UrlLength(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return atob(base64).length;
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required.`);
  return value;
}

function readInteger(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${key} must be an integer.`);
  return value;
}

function readArray(input: Record<string, unknown>, key: string): unknown[] {
  const value = input[key];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array.`);
  return value;
}

function assertIsoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${label}.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
