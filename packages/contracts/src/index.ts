export type RecallBaseCommand =
  | "import"
  | "today"
  | "search"
  | "open"
  | "sources"
  | "backup"
  | "login"
  | "key"
  | "sync"
  | "sync-status"
  | "extension"
  | "extension-install-host"
  | "extension-verify-host"
  | "mcp"
  | "unknown";

export type RecallBaseErrorCode =
  | "empty_store"
  | "invalid_arguments"
  | "not_found"
  | "ambiguous_id"
  | "source_unavailable"
  | "store_error"
  | "auth_required"
  | "auth_failed"
  | "sync_failed"
  | "privacy_violation"
  | "rate_limited"
  | "unsupported_platform";

export interface RecallBaseError {
  code: RecallBaseErrorCode;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

export interface ResultMeta {
  command: RecallBaseCommand;
  generatedAt: string;
  schemaVersion: 1;
  warnings: Diagnostic[];
}

export interface OkEnvelope<T> {
  ok: true;
  meta: ResultMeta;
  data: T;
}

export interface ErrorEnvelope {
  ok: false;
  meta: ResultMeta;
  error: RecallBaseError;
}

export type ResultEnvelope<T> = OkEnvelope<T> | ErrorEnvelope;

export type SourceHealth = "healthy" | "partial" | "absent" | "failed";
export type SourceConfidence = "stable" | "experimental" | "unknown";
export type DiagnosticSeverity = "info" | "warning" | "error";

export interface Diagnostic {
  sourceId?: string;
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  evidenceRef?: string;
}

export interface SourceStatus {
  id: string;
  label: string;
  health: SourceHealth;
  confidence: SourceConfidence;
  confidenceReason: string;
  lastImportAt?: string;
  conversations: number;
  messages: number;
  rawEvidence: number;
  diagnostics: Diagnostic[];
  cursor?: string;
  schemaFingerprint?: string;
  sourceVersion?: string;
}

export interface ImportSourceResult {
  source: SourceStatus;
  changedConversations: number;
  changedMessages: number;
  skippedRecords: number;
}

export interface ImportResult {
  sources: ImportSourceResult[];
  totals: {
    conversations: number;
    messages: number;
    rawEvidence: number;
    diagnostics: number;
  };
}

export interface ConversationRef {
  id: string;
  sourceId: string;
  sourceLabel: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  messageCount: number;
  snippet?: string;
}

export interface SearchResultItem extends ConversationRef {
  score: number;
  matchedMessageId?: string;
}

export interface SearchResult {
  query: string;
  filters: {
    sourceId?: string;
    date?: string;
    limit: number;
  };
  results: SearchResultItem[];
  sourceCoverage: SourceStatus[];
}

export interface TodayResult {
  date: string;
  summary: string;
  keySessions: ConversationRef[];
  continuationHints: string[];
  sourceCoverage: SourceStatus[];
}

export interface MessageDetail {
  id: string;
  upstreamIds?: string[];
  role: "user" | "assistant" | "system" | "tool" | "unknown";
  createdAt: string;
  updatedAt?: string;
  text: string;
  thinking?: string;
  modelId?: string;
  attachments?: MessageAttachment[];
  citations?: MessageCitation[];
  media?: MessageMedia[];
  rawEvidenceId?: string;
}

export interface MessageAttachment {
  id?: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  url?: string;
  width?: number;
  height?: number;
  source?: string;
}

export interface MessageCitation {
  title?: string;
  url: string;
  source?: string;
}

export interface MessageMedia {
  type: "image" | "video" | "file" | "unknown";
  url?: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  duration?: string;
  views?: number;
  uploadedAt?: string;
  mimeType?: string;
  source?: string;
}

export interface BrowserCaptureBranch {
  leafId: string;
  pathIds: string[];
  createdAt?: string;
}

export interface ConversationDetail extends ConversationRef {
  messages: MessageDetail[];
  rawEvidenceRefs: string[];
  diagnostics: Diagnostic[];
}

export interface SourcesResult {
  sources: SourceStatus[];
}

export interface BackupResult {
  path: string;
  exportedAt: string;
  checksumSha256: string;
  counts: {
    sources: number;
    conversations: number;
    messages: number;
    rawEvidence: number;
    diagnostics: number;
  };
}

export interface BrowserExtensionCapturePayload {
  schemaVersion: 1;
  sourceId: string;
  sourceLabel: string;
  site: string;
  upstreamConversationId: string;
  url: string;
  title: string;
  capturedAt: string;
  startedAt: string;
  updatedAt: string;
  branch?: BrowserCaptureBranch;
  messages: Array<{
    upstreamId?: string;
    upstreamIds?: string[];
    role: MessageDetail["role"];
    createdAt: string;
    updatedAt?: string;
    text: string;
    thinking?: string;
    modelId?: string;
    attachments?: MessageAttachment[];
    citations?: MessageCitation[];
    media?: MessageMedia[];
  }>;
  diagnostics: Diagnostic[];
  captureSignature: string;
}

export type ExtensionHostRequest =
  | { type: "health"; protocolVersion: 1 }
  | { type: "import"; protocolVersion: 1; payload: BrowserExtensionCapturePayload }
  | { type: "status"; protocolVersion: 1; sourceId?: string };

export type ExtensionHostResponse =
  | { ok: true; type: "health"; protocolVersion: 1; version: string; dbPath: string }
  | {
      ok: true;
      type: "import";
      protocolVersion: 1;
      result: {
        conversations: number;
        messages: number;
        diagnostics: number;
        sourceId: string;
        captureSignature: string;
      };
    }
  | { ok: true; type: "status"; protocolVersion: 1; sources: SourceStatus[] }
  | { ok: false; type: "error"; error: { code: RecallBaseErrorCode | "bridge_missing" | "protocol_error"; message: string } };

export interface ExtensionHostManifestResult {
  browser: "chrome" | "firefox";
  manifestPath: string;
  hostName: string;
  binaryPath: string;
  allowedIds: string[];
  installed: boolean;
}

export * from "./browser-sites";
export * from "./extension-debug";

export interface ExtensionHostInstallResult {
  manifests: ExtensionHostManifestResult[];
}

export type LoginState =
  | "not_started"
  | "opening_browser"
  | "waiting"
  | "succeeded"
  | "denied"
  | "cancelled"
  | "timeout"
  | "browser_launch_failed"
  | "callback_state_mismatch"
  | "token_storage_failed"
  | "expired"
  | "revoked"
  | "relogin_required";

export interface LoginResult {
  state: LoginState;
  authorizationUrl?: string;
  attemptId?: string;
  userId?: string;
  expiresAt?: string;
}

export interface SyncStatusResult {
  loggedIn: boolean;
  mode: "local_only" | "hybrid_private";
  pendingLocalChanges: number;
  lastSyncAt?: string;
  remoteCursor?: string;
  rawDecryptionAvailable: boolean;
  readableSurface: Array<"metadata" | "snippet" | "optional_summary" | "encrypted_messages">;
}

export interface SyncResult extends SyncStatusResult {
  uploadedSearchDocuments: number;
  uploadedEncryptedRawBlobs: number;
  uploadedEncryptedConversationChunks: number;
  batchId?: string;
}

export interface SyncSearchDocument {
  id: string;
  conversationId: string;
  sourceId: string;
  title: string;
  updatedAt: string;
  snippet: string;
  optionalSummary?: string;
}

export interface ConversationChunkPlaintext {
  schemaVersion: 1;
  conversationId: string;
  messages: MessageDetail[];
}

export interface EncryptedConversationChunkInput {
  conversationId: string;
  chunkId: string;
  partIndex: number;
  partCount: number;
  messageCount: number;
  keyId: string;
  keyVersion: 1;
  algorithm: "AES-GCM";
  ivBase64Url: string;
  ciphertextBase64Url: string;
  contentHashBase64Url: string;
  encryptedAt: string;
}

export interface ConversationChunkManifestPart {
  chunkId: string;
  partIndex: number;
  partCount: number;
  messageCount: number;
  keyId: string;
  keyVersion: 1;
  algorithm: "AES-GCM";
  contentHashBase64Url: string;
}

export interface ConversationChunkManifestInput {
  conversationId: string;
  chunks: ConversationChunkManifestPart[];
}

export interface EncryptedConversationChunk extends EncryptedConversationChunkInput {
  objectKey: string;
}

export interface EncryptedConversationAvailability {
  deviceId: string;
  keyId: string;
  chunkCount: number;
  messageCount: number;
  encryptedAt: string;
}

export interface SyncedConversationDocument {
  document: SyncSearchDocument;
  encryptedConversationChunks: EncryptedConversationChunk[];
  lockedEncryptedConversationChunks?: EncryptedConversationAvailability[];
}

export interface DeviceKeyResult {
  id: string;
  version: 1;
  algorithm: "AES-GCM";
  createdAt: string;
  path?: string;
  rawKeyBase64Url?: string;
}

export function createMeta(command: RecallBaseCommand, warnings: Diagnostic[] = []): ResultMeta {
  return {
    command,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    warnings
  };
}

export function ok<T>(
  command: RecallBaseCommand,
  data: T,
  warnings: Diagnostic[] = []
): OkEnvelope<T> {
  return { ok: true, meta: createMeta(command, warnings), data };
}

export function err(
  command: RecallBaseCommand,
  error: RecallBaseError,
  warnings: Diagnostic[] = []
): ErrorEnvelope {
  return { ok: false, meta: createMeta(command, warnings), error };
}
