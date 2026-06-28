import type { Diagnostic, MessageAttachment, MessageCitation, MessageMedia } from "@recallbase/contracts";

export type MessageRole = "user" | "assistant" | "system" | "tool" | "unknown";

export interface RawEvidenceInput {
  sourceId: string;
  uri: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface NormalizedMessageInput {
  upstreamId?: string;
  upstreamIds?: string[];
  role: MessageRole;
  createdAt: string;
  updatedAt?: string;
  text: string;
  thinking?: string;
  modelId?: string;
  attachments?: MessageAttachment[];
  citations?: MessageCitation[];
  media?: MessageMedia[];
  rawEvidenceUri?: string;
}

export interface NormalizedConversationInput {
  sourceId: string;
  sourceLabel: string;
  upstreamId?: string;
  title: string;
  startedAt: string;
  updatedAt: string;
  messages: NormalizedMessageInput[];
  rawEvidence: RawEvidenceInput[];
  diagnostics?: Diagnostic[];
  metadata?: Record<string, unknown>;
}

export interface ImportBatchInput {
  sourceId: string;
  sourceLabel: string;
  scope?: "full" | "partial";
  conversations: NormalizedConversationInput[];
  diagnostics?: Diagnostic[];
  cursor?: string;
  schemaFingerprint?: string;
  sourceVersion?: string;
  confidence: "stable" | "experimental" | "unknown";
  confidenceReason: string;
}
