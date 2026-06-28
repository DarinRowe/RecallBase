import type { ConversationChunkManifestInput, Diagnostic, EncryptedConversationAvailability, SourceStatus } from "@recallbase/contracts";
import { Sha256TokenVerifier, type AuthSubject, type AuthTokenVerifier } from "../auth/authorization";
import { D1HostedAuthStore } from "../auth/session-store";
import { emptySyncState, type UserSyncState } from "./batch-protocol";
import type { EncryptedConversationChunk } from "@recallbase/contracts";
import type { ConversationChunkStore, EncryptedConversationChunkRecord } from "./conversation-chunks";
import { completeChunkSet } from "./conversation-chunks";
import { type BatchCoordinator } from "./coordinator";
import type { ReadableSyncDocument } from "./privacy-schema";
import type { RawBlobRecord, RawBlobStore } from "./raw-blobs";
import type { SearchIndex, SearchIndexQuery } from "./search-index";
import { type SyncBackend, type SyncStateStore } from "./routes";

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
}

export interface R2Bucket {
  put(key: string, value: string | ArrayBuffer | Uint8Array, options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
}

export interface R2ObjectBody {
  text(): Promise<string>;
}

export interface CloudflareBackendEnv {
  SYNC_DB: D1Database;
  RAW_BUCKET: R2Bucket;
  RECALLBASE_SYNC_TOKEN_SHA256?: string;
  RECALLBASE_SYNC_USER_ID?: string;
  RECALLBASE_SYNC_DEVICE_ID?: string;
  RECALLBASE_SYNC_TOKEN_ID?: string;
  RECALLBASE_SELF_HOSTED_ALLOW_RAW_UPLOADS?: string;
}

export function createCloudflareBackend(env: CloudflareBackendEnv): SyncBackend {
  const hostedAuth = new D1HostedAuthStore(env.SYNC_DB);
  const subject = {
    userId: env.RECALLBASE_SYNC_USER_ID ?? "default-user",
    deviceId: env.RECALLBASE_SYNC_DEVICE_ID ?? "default-device",
    tokenId: env.RECALLBASE_SYNC_TOKEN_ID ?? "default-token"
  };
  return {
    coordinator: new D1BatchCoordinator(env.SYNC_DB),
    searchIndex: new D1SearchIndex(env.SYNC_DB),
    rawBlobs: new R2RawBlobStore(env.RAW_BUCKET),
    conversationChunks: new D1ConversationChunkStore(env.SYNC_DB, env.RAW_BUCKET),
    authTokens: env.RECALLBASE_SYNC_TOKEN_SHA256
      ? new CompositeAuthTokenVerifier([hostedAuth, new Sha256TokenVerifier(env.RECALLBASE_SYNC_TOKEN_SHA256, subject)])
      : hostedAuth,
    webSessions: hostedAuth,
    authStore: hostedAuth,
    states: new D1SyncStateStore(env.SYNC_DB),
    allowRawBlobUploads: env.RECALLBASE_SELF_HOSTED_ALLOW_RAW_UPLOADS === "1"
  };
}

class CompositeAuthTokenVerifier implements AuthTokenVerifier {
  constructor(private readonly verifiers: AuthTokenVerifier[]) {}

  async verify(token: string): Promise<AuthSubject | undefined> {
    for (const verifier of this.verifiers) {
      const subject = await verifier.verify(token);
      if (subject) return subject;
    }
    return undefined;
  }
}

class D1ConversationChunkStore implements ConversationChunkStore {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket
  ) {}

  async putPending(records: EncryptedConversationChunkRecord[]): Promise<void> {
    if (records.length === 0) return;
    await Promise.all(records.map((record) => this.bucket.put(record.objectKey, JSON.stringify(record), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        userId: record.userId,
        deviceId: record.deviceId,
        conversationId: record.conversationId,
        keyId: record.keyId
      }
    })));
    await this.db.batch(
      records.map((record) =>
        this.db
          .prepare(
            `INSERT INTO encrypted_conversation_chunks
             (user_id, device_id, batch_id, conversation_id, chunk_id, part_index, part_count, message_count,
              key_id, key_version, algorithm, iv_base64url, content_hash_base64url, encrypted_at, object_key, completed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
             ON CONFLICT(user_id, device_id, conversation_id, chunk_id) DO UPDATE SET
               batch_id = excluded.batch_id,
               part_index = excluded.part_index,
               part_count = excluded.part_count,
               message_count = excluded.message_count,
               key_id = excluded.key_id,
               key_version = excluded.key_version,
               algorithm = excluded.algorithm,
               iv_base64url = excluded.iv_base64url,
               content_hash_base64url = excluded.content_hash_base64url,
               encrypted_at = excluded.encrypted_at,
               object_key = excluded.object_key,
               completed = 0`
          )
          .bind(
            record.userId,
            record.deviceId,
            record.batchId,
            record.conversationId,
            record.chunkId,
            record.partIndex,
            record.partCount,
            record.messageCount,
            record.keyId,
            record.keyVersion,
            record.algorithm,
            record.ivBase64Url,
            record.contentHashBase64Url,
            record.encryptedAt,
            record.objectKey
          )
      )
    );
  }

  async completeBatch(
    subject: AuthSubject,
    _batchId: string,
    _records: EncryptedConversationChunkRecord[],
    manifests: ConversationChunkManifestInput[]
  ): Promise<void> {
    for (const manifest of manifests) {
      if (manifest.chunks.length > 0) {
        await this.db.batch(
          manifest.chunks.map((chunk) => this.db
            .prepare(
              `UPDATE encrypted_conversation_chunks
               SET completed = 1, part_index = ?, part_count = ?, message_count = ?, key_id = ?, key_version = ?,
                   algorithm = ?, content_hash_base64url = ?
               WHERE user_id = ? AND device_id = ? AND conversation_id = ? AND chunk_id = ?`
            )
            .bind(
              chunk.partIndex,
              chunk.partCount,
              chunk.messageCount,
              chunk.keyId,
              chunk.keyVersion,
              chunk.algorithm,
              chunk.contentHashBase64Url,
              subject.userId,
              subject.deviceId,
              manifest.conversationId,
              chunk.chunkId
            ))
        );
      }
      const chunkIds = manifest.chunks.map((chunk) => chunk.chunkId);
      const placeholders = chunkIds.map(() => "?").join(", ");
      await this.db
        .prepare(
          `DELETE FROM encrypted_conversation_chunks
           WHERE user_id = ? AND device_id = ? AND conversation_id = ?
             ${chunkIds.length > 0 ? `AND chunk_id NOT IN (${placeholders})` : ""}`
        )
        .bind(subject.userId, subject.deviceId, manifest.conversationId, ...chunkIds)
        .run();
    }
  }

  async listCompleted(subject: AuthSubject, conversationId: string): Promise<EncryptedConversationChunk[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM encrypted_conversation_chunks
         WHERE user_id = ? AND device_id = ? AND conversation_id = ? AND completed = 1
         ORDER BY part_index ASC`
      )
      .bind(subject.userId, subject.deviceId, conversationId)
      .all<ConversationChunkRow>();
    const chunks: EncryptedConversationChunk[] = [];
    for (const row of rows.results ?? []) {
      const object = await this.bucket.get(row.object_key);
      if (!object) continue;
      const record = JSON.parse(await object.text()) as EncryptedConversationChunkRecord;
      chunks.push({
        conversationId: row.conversation_id,
        chunkId: row.chunk_id,
        partIndex: row.part_index,
        partCount: row.part_count,
        messageCount: row.message_count,
        keyId: row.key_id,
        keyVersion: 1,
        algorithm: "AES-GCM",
        ivBase64Url: row.iv_base64url,
        ciphertextBase64Url: record.ciphertextBase64Url,
        contentHashBase64Url: row.content_hash_base64url,
        encryptedAt: row.encrypted_at,
        objectKey: row.object_key
      });
    }
    return completeChunkSet(chunks);
  }

  async listAvailability(subject: AuthSubject, conversationId: string): Promise<EncryptedConversationAvailability[]> {
    const rows = await this.db
      .prepare(
        `SELECT device_id, key_id, COUNT(*) AS chunk_count, SUM(message_count) AS message_count, MAX(encrypted_at) AS encrypted_at
         FROM encrypted_conversation_chunks
         WHERE user_id = ? AND conversation_id = ? AND completed = 1
         GROUP BY device_id, key_id
         ORDER BY device_id ASC`
      )
      .bind(subject.userId, conversationId)
      .all<ConversationAvailabilityRow>();
    return (rows.results ?? []).map((row) => ({
      deviceId: row.device_id,
      keyId: row.key_id,
      chunkCount: row.chunk_count,
      messageCount: row.message_count,
      encryptedAt: row.encrypted_at
    }));
  }
}

class D1BatchCoordinator implements BatchCoordinator {
  constructor(private readonly db: D1Database) {}

  async begin(subject: AuthSubject, batchId: string): Promise<"new" | "duplicate"> {
    const existing = await this.db
      .prepare("SELECT batch_id FROM completed_batches WHERE user_id = ? AND device_id = ? AND batch_id = ?")
      .bind(subject.userId, subject.deviceId, batchId)
      .first<{ batch_id: string }>();
    return existing ? "duplicate" : "new";
  }

  async complete(subject: AuthSubject, batchId: string, cursor: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO completed_batches (user_id, device_id, batch_id, cursor, completed_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(subject.userId, subject.deviceId, batchId, cursor, new Date().toISOString())
      .run();
  }

  async isComplete(subject: AuthSubject, batchId: string): Promise<boolean> {
    return Boolean(
      await this.db
        .prepare("SELECT batch_id FROM completed_batches WHERE user_id = ? AND device_id = ? AND batch_id = ?")
        .bind(subject.userId, subject.deviceId, batchId)
        .first()
    );
  }
}

class D1SearchIndex implements SearchIndex {
  constructor(private readonly db: D1Database) {}

  async upsert(documents: ReadableSyncDocument[]): Promise<void> {
    if (documents.length === 0) return;
    await this.db.batch(
      documents.map((document) =>
        this.db
          .prepare(
            `INSERT INTO search_documents
             (id, user_id, batch_id, conversation_id, source_id, title, updated_at, snippet, optional_summary, completed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, id) DO UPDATE SET
               batch_id = excluded.batch_id,
               conversation_id = excluded.conversation_id,
               source_id = excluded.source_id,
               title = excluded.title,
               updated_at = excluded.updated_at,
               snippet = excluded.snippet,
               optional_summary = excluded.optional_summary,
               completed = excluded.completed`
          )
          .bind(
            document.id,
            document.userId,
            document.batchId,
            document.conversationId,
            document.sourceId,
            document.title,
            document.updatedAt,
            document.snippet,
            document.optionalSummary ?? null,
            document.completed ? 1 : 0
          )
      )
    );
  }

  async search(subject: AuthSubject, query: SearchIndexQuery): Promise<ReadableSyncDocument[]> {
    const terms = query.query?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    const clauses = ["user_id = ?", "completed = 1"];
    const values: unknown[] = [subject.userId];
    if (query.sourceId) {
      clauses.push("source_id = ?");
      values.push(query.sourceId);
    }
    if (query.date) {
      clauses.push("updated_at LIKE ?");
      values.push(`${query.date}%`);
    }
    for (const term of terms) {
      clauses.push("(lower(title) LIKE ? OR lower(snippet) LIKE ? OR lower(coalesce(optional_summary, '')) LIKE ?)");
      values.push(`%${term}%`, `%${term}%`, `%${term}%`);
    }
    const rows = await this.db
      .prepare(
        `SELECT * FROM search_documents
         WHERE ${clauses.join(" AND ")}
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .bind(...values, query.limit ?? 20)
      .all<SearchDocumentRow>();
    return (rows.results ?? []).map(toReadableDocument);
  }

  async get(subject: AuthSubject, conversationId: string): Promise<ReadableSyncDocument | undefined> {
    const row = await this.db
      .prepare("SELECT * FROM search_documents WHERE user_id = ? AND conversation_id = ? AND completed = 1 LIMIT 1")
      .bind(subject.userId, conversationId)
      .first<SearchDocumentRow>();
    return row ? toReadableDocument(row) : undefined;
  }
}

class R2RawBlobStore implements RawBlobStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(record: RawBlobRecord): Promise<void> {
    await this.bucket.put(record.objectKey, JSON.stringify(record), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        userId: record.userId,
        deviceId: record.deviceId,
        keyId: record.keyId
      }
    });
  }

  async get(objectKey: string): Promise<RawBlobRecord | undefined> {
    const object = await this.bucket.get(objectKey);
    return object ? JSON.parse(await object.text()) as RawBlobRecord : undefined;
  }
}

class D1SyncStateStore implements SyncStateStore {
  constructor(private readonly db: D1Database) {}

  async get(subject: AuthSubject): Promise<UserSyncState> {
    const row = await this.db
      .prepare("SELECT * FROM sync_devices WHERE user_id = ? AND device_id = ?")
      .bind(subject.userId, subject.deviceId)
      .first<SyncDeviceRow>();
    if (!row) return emptySyncState(subject.userId);

    const state: UserSyncState = {
      userId: subject.userId,
      sources: parseJson<SourceStatus[]>(row.sources_json, []),
      completedBatchIds: new Set(),
      uploadedSearchDocuments: row.uploaded_search_documents,
      uploadedEncryptedConversationChunks: row.uploaded_encrypted_conversation_chunks,
      uploadedEncryptedRawBlobs: row.uploaded_encrypted_raw_blobs
    };
    if (row.remote_cursor) state.remoteCursor = row.remote_cursor;
    if (row.last_sync_at) state.lastSyncAt = row.last_sync_at;
    return state;
  }

  async getForUser(userId: string): Promise<UserSyncState> {
    const rows = await this.db
      .prepare("SELECT * FROM sync_devices WHERE user_id = ? ORDER BY last_sync_at DESC")
      .bind(userId)
      .all<SyncDeviceRow>();
    const states = (rows.results ?? []).map((row) => syncStateFromRow(userId, row));
    return combineUserStates(userId, states);
  }

  async save(subject: AuthSubject, state: UserSyncState, options: { updateSources?: boolean } = {}): Promise<void> {
    if (options.updateSources === false) {
      await this.db
        .prepare(
          `INSERT INTO sync_devices
           (user_id, device_id, remote_cursor, last_sync_at, sources_json, uploaded_search_documents,
            uploaded_encrypted_conversation_chunks, uploaded_encrypted_raw_blobs)
           VALUES (?, ?, ?, ?, '[]', ?, ?, ?)
           ON CONFLICT(user_id, device_id) DO UPDATE SET
             remote_cursor = excluded.remote_cursor,
             last_sync_at = excluded.last_sync_at,
             uploaded_search_documents = excluded.uploaded_search_documents,
             uploaded_encrypted_conversation_chunks = excluded.uploaded_encrypted_conversation_chunks,
             uploaded_encrypted_raw_blobs = excluded.uploaded_encrypted_raw_blobs`
        )
        .bind(
          subject.userId,
          subject.deviceId,
          state.remoteCursor ?? null,
          state.lastSyncAt ?? null,
          state.uploadedSearchDocuments,
          state.uploadedEncryptedConversationChunks,
          state.uploadedEncryptedRawBlobs
        )
        .run();
      return;
    }

    await this.db
      .prepare(
        `INSERT INTO sync_devices
         (user_id, device_id, remote_cursor, last_sync_at, sources_json, uploaded_search_documents,
          uploaded_encrypted_conversation_chunks, uploaded_encrypted_raw_blobs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, device_id) DO UPDATE SET
           remote_cursor = excluded.remote_cursor,
           last_sync_at = excluded.last_sync_at,
           sources_json = excluded.sources_json,
           uploaded_search_documents = excluded.uploaded_search_documents,
           uploaded_encrypted_conversation_chunks = excluded.uploaded_encrypted_conversation_chunks,
           uploaded_encrypted_raw_blobs = excluded.uploaded_encrypted_raw_blobs`
      )
      .bind(
        subject.userId,
        subject.deviceId,
        state.remoteCursor ?? null,
        state.lastSyncAt ?? null,
        JSON.stringify(state.sources),
        state.uploadedSearchDocuments,
        state.uploadedEncryptedConversationChunks,
        state.uploadedEncryptedRawBlobs
      )
      .run();
  }
}

function syncStateFromRow(userId: string, row: SyncDeviceRow): UserSyncState {
  const state: UserSyncState = {
    userId,
    sources: parseJson<SourceStatus[]>(row.sources_json, []),
    completedBatchIds: new Set(),
    uploadedSearchDocuments: row.uploaded_search_documents,
    uploadedEncryptedConversationChunks: row.uploaded_encrypted_conversation_chunks,
    uploadedEncryptedRawBlobs: row.uploaded_encrypted_raw_blobs
  };
  if (row.remote_cursor) state.remoteCursor = row.remote_cursor;
  if (row.last_sync_at) state.lastSyncAt = row.last_sync_at;
  return state;
}

function combineUserStates(userId: string, states: UserSyncState[]): UserSyncState {
  if (states.length === 0) return emptySyncState(userId);
  const combined = emptySyncState(userId);
  const sourcesById = new Map<string, SourceStatus>();
  const sourceUpdatedAt = new Map<string, string | undefined>();
  let latestCursorAt: string | undefined;
  let latestCursorPriority = -1;
  for (const state of states) {
    combined.uploadedSearchDocuments += state.uploadedSearchDocuments;
    combined.uploadedEncryptedConversationChunks += state.uploadedEncryptedConversationChunks;
    combined.uploadedEncryptedRawBlobs += state.uploadedEncryptedRawBlobs;
    if (state.lastSyncAt && isNewer(state.lastSyncAt, combined.lastSyncAt)) combined.lastSyncAt = state.lastSyncAt;
    if (
      state.remoteCursor &&
      state.lastSyncAt &&
      (isNewer(state.lastSyncAt, latestCursorAt) ||
        (state.lastSyncAt === latestCursorAt && statePriority(state) > latestCursorPriority))
    ) {
      latestCursorAt = state.lastSyncAt;
      latestCursorPriority = statePriority(state);
      combined.remoteCursor = state.remoteCursor;
    }
    for (const source of state.sources) {
      const existing = sourcesById.get(source.id);
      if (!existing || shouldReplaceSource(existing, source, state.lastSyncAt, sourceUpdatedAt.get(source.id))) {
        sourcesById.set(source.id, source);
        sourceUpdatedAt.set(source.id, state.lastSyncAt);
      }
    }
  }
  combined.sources = [...sourcesById.values()];
  return combined;
}

function isNewer(candidate: string | undefined, current: string | undefined): boolean {
  return Boolean(candidate && (!current || Date.parse(candidate) > Date.parse(current)));
}

function shouldReplaceSource(existing: SourceStatus, candidate: SourceStatus, candidateUpdatedAt: string | undefined, existingUpdatedAt: string | undefined): boolean {
  if (isNewer(candidateUpdatedAt, existingUpdatedAt)) return true;
  if (candidateUpdatedAt === existingUpdatedAt) {
    return candidate.messages > existing.messages || candidate.conversations > existing.conversations;
  }
  return false;
}

function statePriority(state: UserSyncState): number {
  return state.sources.reduce((sum, source) => sum + source.messages + source.conversations, 0);
}

interface SearchDocumentRow {
  id: string;
  user_id: string;
  batch_id: string;
  conversation_id: string;
  source_id: string;
  title: string;
  updated_at: string;
  snippet: string;
  optional_summary: string | null;
  completed: number;
}

interface SyncDeviceRow {
  remote_cursor: string | null;
  last_sync_at: string | null;
  sources_json: string;
  uploaded_search_documents: number;
  uploaded_encrypted_conversation_chunks: number;
  uploaded_encrypted_raw_blobs: number;
}

interface ConversationChunkRow {
  conversation_id: string;
  chunk_id: string;
  part_index: number;
  part_count: number;
  message_count: number;
  key_id: string;
  iv_base64url: string;
  content_hash_base64url: string;
  encrypted_at: string;
  object_key: string;
}

interface ConversationAvailabilityRow {
  device_id: string;
  key_id: string;
  chunk_count: number;
  message_count: number;
  encrypted_at: string;
}

function toReadableDocument(row: SearchDocumentRow): ReadableSyncDocument {
  const document: ReadableSyncDocument = {
    id: row.id,
    userId: row.user_id,
    batchId: row.batch_id,
    conversationId: row.conversation_id,
    sourceId: row.source_id,
    title: row.title,
    updatedAt: row.updated_at,
    snippet: row.snippet,
    completed: row.completed === 1
  };
  if (row.optional_summary) document.optionalSummary = row.optional_summary;
  return document;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
