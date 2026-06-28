import { MAX_QUERY_LENGTH, MAX_SYNC_DOCUMENTS, assertId, toReadableSearchDocument } from "./privacy-schema";
import type { SyncBatchInput } from "./batch-protocol";
import type { SourceStatus } from "@recallbase/contracts";
import {
  MAX_CONVERSATION_CHUNKS_PER_BATCH,
  validateConversationChunkInput,
  validateConversationChunkManifestInput,
  validateConversationChunkTotals
} from "./conversation-chunks";
import { MAX_RAW_BLOBS_PER_BATCH, validateRawBlobInput, validateRawBlobTotals } from "./raw-blobs";

export function validateSyncBatch(input: unknown): SyncBatchInput {
  if (!isRecord(input)) throw new Error("Sync batch must be an object.");
  const batchId = readString(input, "batchId");
  const cursor = readString(input, "cursor");
  assertId(batchId, "batch id");
  if (cursor.length > 200) throw new Error("Cursor is too long.");
  const searchDocuments = readArray(input, "searchDocuments");
  const encryptedConversationChunks = input.encryptedConversationChunks === undefined
    ? []
    : readArray(input, "encryptedConversationChunks");
  const conversationChunkManifests = input.conversationChunkManifests === undefined
    ? []
    : readArray(input, "conversationChunkManifests");
  const encryptedRawBlobs = readArray(input, "encryptedRawBlobs");
  if (searchDocuments.length > MAX_SYNC_DOCUMENTS) {
    throw new Error("Sync batch has too many search documents.");
  }
  if (encryptedRawBlobs.length > MAX_RAW_BLOBS_PER_BATCH) {
    throw new Error("Sync batch has too many encrypted raw blobs.");
  }
  if (encryptedConversationChunks.length > MAX_CONVERSATION_CHUNKS_PER_BATCH) {
    throw new Error("Sync batch has too many encrypted conversation chunks.");
  }
  if (conversationChunkManifests.length > MAX_CONVERSATION_CHUNKS_PER_BATCH) {
    throw new Error("Sync batch has too many conversation chunk manifests.");
  }
  for (const document of searchDocuments) {
    toReadableSearchDocument(document as SyncBatchInput["searchDocuments"][number], {
      userId: "validation",
      batchId,
      completed: false
    });
  }
  const validatedConversationChunks = encryptedConversationChunks.map((chunk) => validateConversationChunkInput(chunk));
  const validatedConversationChunkManifests = conversationChunkManifests.map((manifest) =>
    validateConversationChunkManifestInput(manifest)
  );
  validateConversationChunkTotals(validatedConversationChunks);
  const validatedRawBlobs = encryptedRawBlobs.map((blob) => validateRawBlobInput(blob));
  validateRawBlobTotals(validatedRawBlobs);
  const batch: SyncBatchInput = {
    batchId,
    cursor,
    searchDocuments: searchDocuments as SyncBatchInput["searchDocuments"],
    encryptedConversationChunks: validatedConversationChunks,
    conversationChunkManifests: validatedConversationChunkManifests,
    encryptedRawBlobs: validatedRawBlobs
  };
  if (Array.isArray(input.sourceStatuses)) {
    batch.sourceStatuses = input.sourceStatuses as SourceStatus[];
  }
  return batch;
}

export function validateSearchParams(url: URL): { query?: string; sourceId?: string; date?: string; limit: number } {
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 50);
  if (!Number.isFinite(limit) || limit < 1) throw new Error("Search limit must be between 1 and 50.");
  const result: { query?: string; sourceId?: string; date?: string; limit: number } = { limit };
  const query = url.searchParams.get("q")?.trim();
  if (query) {
    if (query.length > MAX_QUERY_LENGTH) throw new Error("Search query is too long.");
    result.query = query;
  }
  const sourceId = url.searchParams.get("sourceId")?.trim();
  if (sourceId) result.sourceId = assertId(sourceId, "source id");
  const date = url.searchParams.get("date")?.trim();
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Search date must be YYYY-MM-DD.");
    result.date = date;
  }
  return result;
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required.`);
  return value;
}

function readArray(input: Record<string, unknown>, key: string): unknown[] {
  const value = input[key];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
