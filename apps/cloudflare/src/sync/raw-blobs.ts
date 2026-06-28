import type { AuthSubject } from "../auth/authorization";
import { scopedObjectKey } from "../auth/authorization";
import { MAX_ENCRYPTED_BLOB_BYTES, assertId } from "./privacy-schema";

export const MAX_RAW_BLOBS_PER_BATCH = 100;
const MAX_TOTAL_ENCRYPTED_BLOB_BYTES = 5 * 1024 * 1024;

export interface EncryptedRawBlobInput {
  id: string;
  keyId: string;
  keyVersion: 1;
  algorithm: "AES-GCM";
  ivBase64Url: string;
  ciphertextBase64Url: string;
  contentHashBase64Url: string;
  encryptedAt: string;
}

export interface RawBlobRecord extends EncryptedRawBlobInput {
  objectKey: string;
  userId: string;
  deviceId: string;
}

export interface RawBlobStore {
  put(record: RawBlobRecord): Promise<void>;
  get(objectKey: string): Promise<RawBlobRecord | undefined>;
}

export class MemoryRawBlobStore implements RawBlobStore {
  private readonly records = new Map<string, RawBlobRecord>();

  async put(record: RawBlobRecord): Promise<void> {
    this.records.set(record.objectKey, record);
  }

  async get(objectKey: string): Promise<RawBlobRecord | undefined> {
    return this.records.get(objectKey);
  }
}

export function toRawBlobRecord(blob: EncryptedRawBlobInput, subject: AuthSubject): RawBlobRecord {
  const validated = validateRawBlobInput(blob);
  return {
    ...validated,
    objectKey: scopedObjectKey(subject, `raw/${validated.id}`),
    userId: subject.userId,
    deviceId: subject.deviceId
  };
}

export function validateRawBlobInput(blob: unknown): EncryptedRawBlobInput {
  if (!isRecord(blob)) throw new Error("Encrypted raw blob must be an object.");
  const id = readString(blob, "id");
  const keyId = readString(blob, "keyId");
  const ivBase64Url = readString(blob, "ivBase64Url");
  const ciphertextBase64Url = readString(blob, "ciphertextBase64Url");
  const contentHashBase64Url = readString(blob, "contentHashBase64Url");
  const encryptedAt = readString(blob, "encryptedAt");
  assertId(id, "raw blob id");
  assertId(keyId, "raw key id");
  if (blob.algorithm !== "AES-GCM" || blob.keyVersion !== 1) {
    throw new Error("Unsupported raw blob encryption metadata.");
  }
  assertIsoDate(encryptedAt, "encryptedAt");
  const ivLength = decodedBase64UrlLength(ivBase64Url, "raw blob iv");
  if (ivLength !== 12) throw new Error("Raw blob IV must be 12 bytes.");
  const ciphertextLength = decodedBase64UrlLength(ciphertextBase64Url, "raw blob ciphertext");
  const hashLength = decodedBase64UrlLength(contentHashBase64Url, "raw blob content hash");
  if (hashLength !== 32) throw new Error("Raw blob content hash must be 32 bytes.");
  if (ciphertextLength > MAX_ENCRYPTED_BLOB_BYTES) {
    throw new Error("Encrypted raw blob is too large.");
  }
  return {
    id,
    keyId,
    keyVersion: 1,
    algorithm: "AES-GCM",
    ivBase64Url,
    ciphertextBase64Url,
    contentHashBase64Url,
    encryptedAt
  };
}

export function validateRawBlobTotals(blobs: EncryptedRawBlobInput[]): void {
  const total = blobs.reduce((sum, blob) => sum + decodedBase64UrlLength(blob.ciphertextBase64Url, "raw blob ciphertext"), 0);
  if (total > MAX_TOTAL_ENCRYPTED_BLOB_BYTES) throw new Error("Encrypted raw blob batch is too large.");
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

function assertIsoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${label}.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
