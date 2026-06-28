import type { SourceStatus, SyncResult } from "@recallbase/contracts";
import { authorizeRequest } from "../auth/authorization";
import { MemoryAuthTokenVerifier, type AuthSubject, type AuthTokenVerifier } from "../auth/authorization";
import { readCookie } from "../auth/google-oauth";
import { MemoryHostedAuthStore, type HostedAuthStore } from "../auth/session-store";
import { emptySyncState, toSyncStatus, type SyncBatchInput, type UserSyncState } from "./batch-protocol";
import {
  MemoryConversationChunkStore,
  toConversationChunkRecord,
  type ConversationChunkStore
} from "./conversation-chunks";
import { MemoryBatchCoordinator, type BatchCoordinator } from "./coordinator";
import { toReadableSearchDocument } from "./privacy-schema";
import { MemoryRawBlobStore, toRawBlobRecord, type RawBlobStore } from "./raw-blobs";
import { MemorySearchIndex, toPublicSearchDocument, type SearchIndex } from "./search-index";
import { validateSearchParams, validateSyncBatch } from "./validation";

export interface SyncBackend {
  coordinator: BatchCoordinator;
  searchIndex: SearchIndex;
  rawBlobs: RawBlobStore;
  conversationChunks: ConversationChunkStore;
  authTokens: AuthTokenVerifier;
  webSessions?: Pick<HostedAuthStore, "verifyWebSession">;
  authStore?: HostedAuthStore;
  states: SyncStateStore;
  allowRawBlobUploads?: boolean;
}

export interface SyncStateStore {
  get(subject: AuthSubject): Promise<UserSyncState>;
  getForUser?(userId: string): Promise<UserSyncState>;
  save(subject: AuthSubject, state: UserSyncState, options?: { updateSources?: boolean }): Promise<void>;
}

export const TEST_TOKEN_USER_A_DEVICE_A = "rb_test_token_user_a_device_a";
export const TEST_TOKEN_USER_A_DEVICE_B = "rb_test_token_user_a_device_b";
export const TEST_TOKEN_USER_B_DEVICE_B = "rb_test_token_user_b_device_b";

export function createMemoryBackend(): SyncBackend {
  const hostedAuth = new MemoryHostedAuthStore();
  const testTokens = new MemoryAuthTokenVerifier(
    new Map([
      [
        TEST_TOKEN_USER_A_DEVICE_A,
        { userId: "user-a", deviceId: "device-a", tokenId: "token-a" }
      ],
      [
        TEST_TOKEN_USER_A_DEVICE_B,
        { userId: "user-a", deviceId: "device-b", tokenId: "token-a-b" }
      ],
      [
        TEST_TOKEN_USER_B_DEVICE_B,
        { userId: "user-b", deviceId: "device-b", tokenId: "token-b" }
      ]
    ])
  );
  return {
    coordinator: new MemoryBatchCoordinator(),
    searchIndex: new MemorySearchIndex(),
    rawBlobs: new MemoryRawBlobStore(),
    conversationChunks: new MemoryConversationChunkStore(),
    authTokens: new CompositeAuthTokenVerifier([hostedAuth, testTokens]),
    webSessions: hostedAuth,
    authStore: hostedAuth,
    states: new MemorySyncStateStore()
  };
}

export async function handleSyncRoute(request: Request, backend: SyncBackend): Promise<Response | undefined> {
  const url = new URL(request.url);
  const auth = await authorizeBackendRequest(request, backend);
  if (!auth.ok) return json({ ok: false, error: { code: "auth_required", message: auth.message } }, auth.status);

  try {
    if (request.method === "GET" && url.pathname === "/api/sync/status") {
      return json({ ok: true, data: toSyncStatus(auth.subject, await stateForSubject(backend, auth.subject)) });
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      const state = await stateForSubject(backend, auth.subject);
      return json({ ok: true, data: { sync: toSyncStatus(auth.subject, state), sources: state.sources } });
    }
    if (request.method === "POST" && url.pathname === "/api/sync/batches") {
      return json({ ok: true, data: await commitBatch(auth.subject, backend, validateSyncBatch(await request.json())) });
    }
    if (request.method === "GET" && url.pathname === "/api/search") {
      const documents = await backend.searchIndex.search(auth.subject, validateSearchParams(url));
      return json({ ok: true, data: { results: documents.map(toPublicSearchDocument) } });
    }
    const conversationMatch = /^\/api\/conversations\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && conversationMatch?.[1]) {
      const document = await backend.searchIndex.get(auth.subject, conversationMatch[1]);
      if (!document) {
        return json({ ok: false, error: { code: "not_found", message: "Conversation is not synced or is incomplete." } }, 404);
      }
      if (auth.subject.tokenId.startsWith("session:")) {
        const lockedEncryptedConversationChunks = await backend.conversationChunks.listAvailability(auth.subject, conversationMatch[1]);
        return json({
          ok: true,
          data: { document: toPublicSearchDocument(document), encryptedConversationChunks: [], lockedEncryptedConversationChunks }
        });
      }
      const encryptedConversationChunks = await backend.conversationChunks.listCompleted(auth.subject, conversationMatch[1]);
      return json({ ok: true, data: { document: toPublicSearchDocument(document), encryptedConversationChunks } });
    }
  } catch (error) {
    if (error instanceof PrivacyBoundaryError) {
      return json({ ok: false, error: { code: "privacy_violation", message: error.message } }, 400);
    }
    return json(
      { ok: false, error: { code: "invalid_arguments", message: error instanceof Error ? error.message : "Invalid request." } },
      400
    );
  }

  return undefined;
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

async function authorizeBackendRequest(request: Request, backend: SyncBackend) {
  const bearer = await authorizeRequest(request, backend.authTokens);
  if (bearer.ok || request.method !== "GET" || !backend.webSessions) return bearer;

  const sessionId = readCookie(request, "rb_session");
  if (!sessionId) return bearer;
  const subject = await backend.webSessions.verifyWebSession(sessionId);
  return subject
    ? { ok: true as const, subject }
    : { ok: false as const, status: 401 as const, message: "Web session is invalid or expired." };
}

async function stateForSubject(backend: SyncBackend, subject: AuthSubject): Promise<UserSyncState> {
  if (subject.tokenId.startsWith("session:") && backend.states.getForUser) return backend.states.getForUser(subject.userId);
  return backend.states.get(subject);
}

export async function commitBatch(
  subject: AuthSubject,
  backend: SyncBackend,
  batch: SyncBatchInput
): Promise<SyncResult> {
  if (batch.encryptedRawBlobs.length > 0 && !backend.allowRawBlobUploads) {
    throw new PrivacyBoundaryError(
      "Hosted RecallBase does not accept raw evidence uploads. Raw local archives stay on this device; sync only sends bounded readable search documents and encrypted normalized conversation chunks."
    );
  }

  const state = await backend.states.get(subject);
  const batchState = await backend.coordinator.begin(subject, batch.batchId);
  if (batchState === "duplicate") {
    const duplicate: SyncResult = {
      ...toSyncStatus(subject, state),
      uploadedSearchDocuments: 0,
      uploadedEncryptedRawBlobs: 0,
      uploadedEncryptedConversationChunks: 0,
      batchId: batch.batchId
    };
    return duplicate;
  }

  const readableDocuments = batch.searchDocuments.map((document) =>
    toReadableSearchDocument(document, { userId: subject.userId, batchId: batch.batchId, completed: true })
  );
  const rawRecords = batch.encryptedRawBlobs.map((blob) => toRawBlobRecord(blob, subject));
  const conversationChunkRecords = batch.encryptedConversationChunks.map((chunk) =>
    toConversationChunkRecord(chunk, subject, batch.batchId)
  );

  for (const record of rawRecords) {
    await backend.rawBlobs.put(record);
  }
  await backend.conversationChunks.putPending(conversationChunkRecords);
  await backend.conversationChunks.completeBatch(
    subject,
    batch.batchId,
    conversationChunkRecords,
    batch.conversationChunkManifests
  );
  await backend.searchIndex.upsert(readableDocuments);
  await backend.coordinator.complete(subject, batch.batchId, batch.cursor);

  state.remoteCursor = batch.cursor;
  state.lastSyncAt = new Date().toISOString();
  state.uploadedSearchDocuments += readableDocuments.length;
  state.uploadedEncryptedConversationChunks += conversationChunkRecords.length;
  state.uploadedEncryptedRawBlobs += rawRecords.length;
  state.completedBatchIds.add(batch.batchId);
  const updateSources = batch.sourceStatuses !== undefined;
  if (updateSources) state.sources = batch.sourceStatuses as SourceStatus[];
  await backend.states.save(subject, state, { updateSources });

  return {
    ...toSyncStatus(subject, state),
    uploadedSearchDocuments: readableDocuments.length,
    uploadedEncryptedConversationChunks: conversationChunkRecords.length,
    uploadedEncryptedRawBlobs: rawRecords.length,
    batchId: batch.batchId
  };
}

class PrivacyBoundaryError extends Error {}

export class MemorySyncStateStore implements SyncStateStore {
  private readonly states = new Map<string, UserSyncState>();

  async get(subject: AuthSubject): Promise<UserSyncState> {
    const key = `${subject.userId}:${subject.deviceId}`;
    const existing = this.states.get(key);
    if (existing) return existing;
    const state = emptySyncState(subject.userId);
    this.states.set(key, state);
    return state;
  }

  async getForUser(userId: string): Promise<UserSyncState> {
    const states = [...this.states.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([, state]) => state);
    return combineUserStates(userId, states);
  }

  async save(subject: AuthSubject, state: UserSyncState): Promise<void> {
    this.states.set(`${subject.userId}:${subject.deviceId}`, state);
  }
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

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
