import {
  err,
  ok,
  type ConversationChunkManifestInput,
  type ConversationChunkManifestPart,
  type SyncSearchDocument,
  type EncryptedConversationChunkInput,
  type ResultEnvelope,
  type SyncResult,
  type SyncStatusResult
} from "@recallbase/contracts";
import {
  chunkConversationMessages,
  conversationChunkPlaintextDigest,
  encryptConversationChunk,
  fromBase64Url,
  importDeviceRawKey,
  stableHash
} from "@recallbase/core";
import { FileTokenStore } from "../auth/token-store";
import { FileDeviceKeyStore } from "../auth/device-key-store";
import type { CommandContext } from "./shared";

const MAX_CONVERSATION_CHUNKS_PER_SYNC_BATCH = 5;
const MAX_CONVERSATION_CIPHERTEXT_BYTES_PER_SYNC_BATCH = 256 * 1024;

export async function syncStatusCommand(context: CommandContext): Promise<ResultEnvelope<SyncStatusResult>> {
  const token = new FileTokenStore(context.flags.authPath || undefined).read();
  const lastSyncAt = context.db.getSyncState("lastSyncAt");
  const deviceKey = new FileDeviceKeyStore(context.flags.deviceKeyPath).read();
  const pendingLocalChanges = token && context.flags.syncUrl && deviceKey
    ? await countPendingLocalChanges(context, context.flags.syncUrl.replace(/\/$/, ""), deviceKey.id)
    : context.db.syncSearchDocuments().length;
  const result: SyncStatusResult = {
    loggedIn: token !== undefined,
    mode: token ? "hybrid_private" : "local_only",
    pendingLocalChanges,
    rawDecryptionAvailable: token === undefined,
    readableSurface: token ? ["metadata", "snippet", "optional_summary", "encrypted_messages"] : []
  };
  if (lastSyncAt !== undefined) result.lastSyncAt = lastSyncAt;
  return ok("sync-status", result);
}

export async function syncCommand(context: CommandContext): Promise<ResultEnvelope<SyncResult>> {
  const token = new FileTokenStore(context.flags.authPath || undefined).read();
  if (!token) return err("sync", {
    code: "auth_required",
    message: "Sync is explicit opt-in and requires login.",
    hint: "Run rb login, then rb sync."
  });
  if (!context.flags.syncUrl) return err("sync", {
    code: "sync_failed",
    message: "Sync URL is not configured.",
    hint: "Set RECALLBASE_SYNC_URL or pass --sync-url."
  });

  const syncUrl = context.flags.syncUrl.replace(/\/$/, "");
  const limit = context.flags.limit ?? 5000;
  const rawKey = await importDeviceRawKey(await new FileDeviceKeyStore(context.flags.deviceKeyPath).readOrCreate());
  const manifestKey = syncManifestKey(syncUrl, rawKey.id);
  const previousManifest = context.flags.force ? emptyManifest() : readSyncManifest(context, manifestKey);
  const nextManifest = emptyManifest();
  const allDocuments = context.db.syncSearchDocuments(limit);
  const documents = changedSearchDocuments(allDocuments, previousManifest, nextManifest);
  const sourceStatuses = context.db.sources();
  nextManifest.sources = stableHash(JSON.stringify(sourceStatuses));
  const changedConversations: ChangedConversationSync[] = [];
  for (const conversation of context.db.syncConversationDetails(limit)) {
    const chunks = chunkConversationMessages(conversation.id, conversation.messages);
    const previousConversation = previousManifest.conversations[conversation.id];
    const previousChunks = Array.isArray(previousConversation?.chunks) ? previousConversation.chunks : [];
    const manifestParts: LocalChunkManifestPart[] = [];
    const encryptedConversationChunks: EncryptedConversationChunkInput[] = [];
    let conversationChanged = context.flags.force || chunks.length !== previousChunks.length;
    for (const chunk of chunks) {
      const digest = await conversationChunkPlaintextDigest(chunk);
      const localPartBase = {
        chunkId: digest.chunkId,
        partIndex: digest.partIndex,
        partCount: digest.partCount,
        messageCount: digest.messageCount,
        keyId: rawKey.id,
        keyVersion: 1 as const,
        algorithm: "AES-GCM" as const
      };
      const previousPart = previousChunks.find((part) => part.chunkId === localPartBase.chunkId);
      const chunkChanged =
        !previousPart ||
        previousPart.plaintextHashBase64Url !== digest.plaintextHashBase64Url ||
        signatureForChunkManifestPart(previousPart) !== signatureForChunkManifestPart({
          ...localPartBase,
          contentHashBase64Url: previousPart.contentHashBase64Url
        });
      if (chunkChanged) {
        conversationChanged = true;
        const encrypted = await encryptConversationChunk(chunk, rawKey);
        encryptedConversationChunks.push(encrypted);
        manifestParts.push({
          ...localPartBase,
          contentHashBase64Url: encrypted.contentHashBase64Url,
          plaintextHashBase64Url: digest.plaintextHashBase64Url
        });
      } else {
        manifestParts.push(previousPart);
      }
    }
    nextManifest.conversations[conversation.id] = { chunks: manifestParts };
    if (conversationChanged) {
      changedConversations.push({
        encryptedConversationChunks,
        manifest: { conversationId: conversation.id, chunks: manifestParts.map(toServerManifestPart) }
      });
    }
  }
  const documentChunks = chunk(documents, 100);
  const conversationBatches = chunkChangedConversations(changedConversations);
  const shouldSyncSources = context.flags.force || previousManifest.sources !== nextManifest.sources;
  const batchCount = Math.max(documentChunks.length, conversationBatches.length, shouldSyncSources ? 1 : 0);
  let uploadedSearchDocuments = 0;
  let uploadedEncryptedRawBlobs = 0;
  let uploadedEncryptedConversationChunks = 0;
  let latest: SyncResult | undefined;

  if (batchCount === 0) {
    const lastSyncAt = new Date().toISOString();
    context.db.setSyncState("lastSyncAt", lastSyncAt);
    context.db.setSyncState(manifestKey, JSON.stringify(nextManifest));
    return ok("sync", {
      loggedIn: true,
      mode: "hybrid_private",
      pendingLocalChanges: 0,
      rawDecryptionAvailable: false,
      readableSurface: ["metadata", "snippet", "optional_summary", "encrypted_messages"],
      uploadedSearchDocuments: 0,
      uploadedEncryptedRawBlobs: 0,
      uploadedEncryptedConversationChunks: 0,
      lastSyncAt
    });
  }

  for (let index = 0; index < batchCount; index += 1) {
    const batchId = `batch_${Date.now()}_${index + 1}`;
    const isLastBatch = index === batchCount - 1;
    const batchSearchDocuments = documentChunks[index] ?? [];
    const batchConversationChunks = conversationBatches[index]?.encryptedConversationChunks ?? [];
    const batchConversationManifests = conversationBatches[index]?.conversationChunkManifests ?? [];
    const response = await fetch(`${syncUrl}/api/sync/batches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        batchId,
        cursor: batchId,
        searchDocuments: batchSearchDocuments,
        encryptedConversationChunks: batchConversationChunks,
        conversationChunkManifests: batchConversationManifests,
        encryptedRawBlobs: [],
        ...(isLastBatch && shouldSyncSources ? { sourceStatuses } : {})
      })
    }).catch(() => undefined);

    if (!response) return err("sync", { code: "sync_failed", message: "Sync service is unavailable." });
    const responseText = await response.text().catch(() => "");
    const payload = parseSyncResponse(responseText);
    if (!response.ok || !payload?.ok) {
      return err("sync", {
        code: response.status === 401 || response.status === 403 ? "auth_failed" : "sync_failed",
        message: payload && !payload.ok ? payload.error.message : `Sync failed with HTTP ${response.status}.`,
        ...(!payload?.ok ? {
          details: {
            status: response.status,
            batchIndex: index + 1,
            batchCount,
            searchDocuments: batchSearchDocuments.length,
            encryptedConversationChunks: batchConversationChunks.length,
            conversationChunkManifests: batchConversationManifests.length,
            encryptedConversationBytes: totalEncryptedConversationBytes(batchConversationChunks),
            response: responseText.slice(0, 500)
          }
        } : {})
      });
    }
    const syncData = validateSyncResultContract(payload.data);
    if (!syncData.ok) {
      return err("sync", {
        code: "sync_failed",
        message: syncData.message,
        hint: "Deploy the current RecallBase Cloudflare Worker, then rerun rb sync."
      });
    }
    uploadedSearchDocuments += payload.data.uploadedSearchDocuments;
    uploadedEncryptedRawBlobs += payload.data.uploadedEncryptedRawBlobs;
    uploadedEncryptedConversationChunks += payload.data.uploadedEncryptedConversationChunks;
    latest = payload.data;
  }

  const lastSyncAt = latest?.lastSyncAt ?? new Date().toISOString();
  context.db.setSyncState("lastSyncAt", lastSyncAt);
  context.db.setSyncState(manifestKey, JSON.stringify(nextManifest));
  return ok("sync", {
    ...(latest ?? {
      loggedIn: true,
      mode: "hybrid_private" as const,
      pendingLocalChanges: 0,
      rawDecryptionAvailable: false,
      readableSurface: ["metadata", "snippet", "optional_summary", "encrypted_messages"] as const
    }),
    uploadedSearchDocuments,
    uploadedEncryptedRawBlobs,
    uploadedEncryptedConversationChunks,
    lastSyncAt
  });
}

interface SyncManifest {
  searchDocuments: Record<string, string>;
  conversations: Record<string, { chunks: LocalChunkManifestPart[] }>;
  sources?: string;
}

interface ChangedConversationSync {
  encryptedConversationChunks: EncryptedConversationChunkInput[];
  manifest: ConversationChunkManifestInput;
}

interface ConversationSyncBatch {
  encryptedConversationChunks: EncryptedConversationChunkInput[];
  conversationChunkManifests: ConversationChunkManifestInput[];
}

interface LocalChunkManifestPart extends ConversationChunkManifestPart {
  plaintextHashBase64Url: string;
}

function emptyManifest(): SyncManifest {
  return { searchDocuments: {}, conversations: {} };
}

function syncManifestKey(syncUrl: string, keyId: string): string {
  return `syncManifest:v1:${stableHash(syncUrl).slice(0, 16)}:${keyId}`;
}

function readSyncManifest(context: CommandContext, key: string): SyncManifest {
  const value = context.db.getSyncState(key);
  if (!value) return emptyManifest();
  try {
    const parsed = JSON.parse(value) as Partial<SyncManifest>;
    return {
      searchDocuments: parsed.searchDocuments ?? {},
      conversations: (parsed.conversations as SyncManifest["conversations"] | undefined) ?? {},
      ...(parsed.sources ? { sources: parsed.sources } : {})
    };
  } catch {
    return emptyManifest();
  }
}

async function countPendingLocalChanges(context: CommandContext, syncUrl: string, keyId: string): Promise<number> {
  const previousManifest = readSyncManifest(context, syncManifestKey(syncUrl, keyId));
  const nextManifest = emptyManifest();
  let pending = changedSearchDocuments(context.db.syncSearchDocuments(context.flags.limit ?? 5000), previousManifest, nextManifest).length;
  const sourceSignature = stableHash(JSON.stringify(context.db.sources()));
  if (previousManifest.sources !== sourceSignature) pending += 1;
  for (const conversation of context.db.syncConversationDetails(context.flags.limit ?? 5000)) {
    const previousChunks = previousManifest.conversations[conversation.id]?.chunks ?? [];
    const chunks = chunkConversationMessages(conversation.id, conversation.messages);
    if (chunks.length !== previousChunks.length) {
      pending += 1;
      continue;
    }
    for (const chunk of chunks) {
      const digest = await conversationChunkPlaintextDigest(chunk);
      const previousPart = previousChunks.find((part) => part.chunkId === digest.chunkId);
      if (!previousPart || previousPart.plaintextHashBase64Url !== digest.plaintextHashBase64Url) {
        pending += 1;
        break;
      }
    }
  }
  return pending;
}

function changedSearchDocuments(
  documents: SyncSearchDocument[],
  previous: SyncManifest,
  next: SyncManifest
): SyncSearchDocument[] {
  return documents.filter((document) => {
    const signature = stableHash(JSON.stringify(document));
    next.searchDocuments[document.id] = signature;
    return previous.searchDocuments[document.id] !== signature;
  });
}

function signatureForChunkManifestPart(part: ConversationChunkManifestPart): string {
  return stableHash(JSON.stringify(toServerManifestPart(part)));
}

function toServerManifestPart(part: ConversationChunkManifestPart): ConversationChunkManifestPart {
  return {
    chunkId: part.chunkId,
    partIndex: part.partIndex,
    partCount: part.partCount,
    messageCount: part.messageCount,
    keyId: part.keyId,
    keyVersion: part.keyVersion,
    algorithm: part.algorithm,
    contentHashBase64Url: part.contentHashBase64Url
  };
}

function totalEncryptedConversationBytes(chunks: EncryptedConversationChunkInput[]): number {
  return chunks.reduce((sum, chunk) => sum + fromBase64Url(chunk.ciphertextBase64Url).byteLength, 0);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function validateSyncResultContract(data: SyncResult): { ok: true } | { ok: false; message: string } {
  if (typeof data.uploadedEncryptedConversationChunks !== "number") {
    return { ok: false, message: "Sync service does not support encrypted conversation chunks." };
  }
  if (typeof data.uploadedSearchDocuments !== "number" || typeof data.uploadedEncryptedRawBlobs !== "number") {
    return { ok: false, message: "Sync service returned an unsupported sync result shape." };
  }
  return { ok: true };
}

function chunkChangedConversations(groups: ChangedConversationSync[]): ConversationSyncBatch[] {
  const batches: ConversationSyncBatch[] = [];
  let current: ConversationSyncBatch = { encryptedConversationChunks: [], conversationChunkManifests: [] };
  let currentBytes = 0;
  let currentChunks = 0;

  for (const group of groups) {
    const chunkGroups = chunkEncryptedConversationChunks(group.encryptedConversationChunks);
    if (chunkGroups.length === 0) chunkGroups.push([]);
    for (const [groupIndex, encryptedConversationChunks] of chunkGroups.entries()) {
      const size = totalEncryptedConversationBytes(encryptedConversationChunks);
      const chunkCount = encryptedConversationChunks.length;
      if (
        (current.encryptedConversationChunks.length > 0 || current.conversationChunkManifests.length > 0) &&
        (currentChunks + chunkCount > MAX_CONVERSATION_CHUNKS_PER_SYNC_BATCH ||
          currentBytes + size > MAX_CONVERSATION_CIPHERTEXT_BYTES_PER_SYNC_BATCH)
      ) {
        batches.push(current);
        current = { encryptedConversationChunks: [], conversationChunkManifests: [] };
        currentBytes = 0;
        currentChunks = 0;
      }
      current.encryptedConversationChunks.push(...encryptedConversationChunks);
      currentBytes += size;
      currentChunks += chunkCount;
      if (groupIndex === chunkGroups.length - 1) current.conversationChunkManifests.push(group.manifest);
    }
  }

  if (current.encryptedConversationChunks.length > 0 || current.conversationChunkManifests.length > 0) batches.push(current);
  return batches;
}

function chunkEncryptedConversationChunks(chunks: EncryptedConversationChunkInput[]): EncryptedConversationChunkInput[][] {
  const batches: EncryptedConversationChunkInput[][] = [];
  let current: EncryptedConversationChunkInput[] = [];
  let currentBytes = 0;

  for (const chunk of chunks) {
    const size = totalEncryptedConversationBytes([chunk]);
    if (
      current.length > 0 &&
      (current.length + 1 > MAX_CONVERSATION_CHUNKS_PER_SYNC_BATCH ||
        currentBytes + size > MAX_CONVERSATION_CIPHERTEXT_BYTES_PER_SYNC_BATCH)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(chunk);
    currentBytes += size;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function parseSyncResponse(text: string): ResultEnvelope<SyncResult> | undefined {
  try {
    return JSON.parse(text) as ResultEnvelope<SyncResult>;
  } catch {
    return undefined;
  }
}
