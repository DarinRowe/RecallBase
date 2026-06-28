import type {
  ConversationChunkManifestInput,
  EncryptedConversationChunkInput,
  SourceStatus,
  SyncStatusResult
} from "@recallbase/contracts";
import type { AuthSubject } from "../auth/authorization";
import type { EncryptedRawBlobInput } from "./raw-blobs";
import type { SearchDocumentInput } from "./privacy-schema";

export interface SyncBatchInput {
  batchId: string;
  cursor: string;
  searchDocuments: SearchDocumentInput[];
  encryptedConversationChunks: EncryptedConversationChunkInput[];
  conversationChunkManifests: ConversationChunkManifestInput[];
  encryptedRawBlobs: EncryptedRawBlobInput[];
  sourceStatuses?: SourceStatus[];
}

export interface UserSyncState {
  userId: string;
  remoteCursor?: string;
  lastSyncAt?: string;
  sources: SourceStatus[];
  completedBatchIds: Set<string>;
  uploadedSearchDocuments: number;
  uploadedEncryptedConversationChunks: number;
  uploadedEncryptedRawBlobs: number;
}

export function emptySyncState(userId: string): UserSyncState {
  return {
    userId,
    sources: [],
    completedBatchIds: new Set(),
    uploadedSearchDocuments: 0,
    uploadedEncryptedConversationChunks: 0,
    uploadedEncryptedRawBlobs: 0
  };
}

export function toSyncStatus(subject: AuthSubject, state: UserSyncState): SyncStatusResult {
  const status: SyncStatusResult = {
    loggedIn: true,
    mode: "hybrid_private",
    pendingLocalChanges: 0,
    rawDecryptionAvailable: false,
    readableSurface: ["metadata", "snippet", "optional_summary", "encrypted_messages"]
  };
  if (state.remoteCursor !== undefined) status.remoteCursor = state.remoteCursor;
  if (state.lastSyncAt !== undefined) status.lastSyncAt = state.lastSyncAt;
  void subject;
  return status;
}
