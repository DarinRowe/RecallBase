import type { SyncSearchDocument } from "@recallbase/contracts";
import { redactSensitiveText } from "../observability/redaction";

export const MAX_SYNC_DOCUMENTS = 100;
export const MAX_QUERY_LENGTH = 120;
export const MAX_SNIPPET_LENGTH = 280;
export const MAX_SUMMARY_LENGTH = 600;
export const MAX_ENCRYPTED_BLOB_BYTES = 512 * 1024;

export interface ReadableSyncDocument extends SyncSearchDocument {
  sourceLabel?: string;
  startedAt?: string;
  batchId: string;
  userId: string;
  completed: boolean;
}

export interface SearchDocumentInput {
  id: string;
  conversationId: string;
  sourceId: string;
  sourceLabel?: string;
  title: string;
  updatedAt: string;
  startedAt?: string;
  snippet: string;
  optionalSummary?: string;
}

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,96}$/;

export function toReadableSearchDocument(
  input: SearchDocumentInput,
  scope: { userId: string; batchId: string; completed: boolean }
): ReadableSyncDocument {
  assertId(input.id, "search document id");
  assertId(input.conversationId, "conversation id");
  assertId(input.sourceId, "source id");

  const doc: ReadableSyncDocument = {
    id: input.id,
    conversationId: input.conversationId,
    sourceId: input.sourceId,
    title: boundedReadableText(input.title, 160),
    updatedAt: assertIsoDate(input.updatedAt, "updatedAt"),
    snippet: boundedReadableText(input.snippet, MAX_SNIPPET_LENGTH),
    batchId: scope.batchId,
    userId: scope.userId,
    completed: scope.completed
  };
  if (input.sourceLabel !== undefined) doc.sourceLabel = boundedReadableText(input.sourceLabel, 80);
  if (input.startedAt !== undefined) doc.startedAt = assertIsoDate(input.startedAt, "startedAt");
  if (input.optionalSummary !== undefined) {
    doc.optionalSummary = boundedReadableText(input.optionalSummary, MAX_SUMMARY_LENGTH);
  }
  return doc;
}

export function boundedReadableText(value: string, limit: number): string {
  const compact = redactSensitiveText(value).replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : compact.slice(0, limit - 3).trimEnd() + "...";
}

export function assertId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

export function assertIsoDate(value: string, label: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid ${label}.`);
  }
  return new Date(timestamp).toISOString();
}
