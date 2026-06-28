export const EXTENSION_DEBUG_SCHEMA_VERSION = 1 as const;

export const extensionDebugTraceContexts = [
  "content",
  "background",
  "popup",
  "export-studio",
  "debug-page",
  "test"
] as const;

export const extensionDebugTraceCategories = [
  "capture",
  "site-api",
  "dom",
  "runtime",
  "storage",
  "privacy",
  "native",
  "export",
  "ui",
  "debug"
] as const;

export const extensionDebugTraceStatuses = [
  "start",
  "success",
  "failure",
  "skipped",
  "info"
] as const;

export type ExtensionDebugTraceContext = (typeof extensionDebugTraceContexts)[number];
export type ExtensionDebugTraceCategory = (typeof extensionDebugTraceCategories)[number];
export type ExtensionDebugTraceStatus = (typeof extensionDebugTraceStatuses)[number];

export interface ExtensionDebugRedactionSummary {
  total: number;
  byReason: Record<string, number>;
}

export interface ExtensionDebugErrorSummary {
  name: string;
  code?: string;
  messageHash?: string;
}

export interface ExtensionDebugTraceEvent {
  schemaVersion: typeof EXTENSION_DEBUG_SCHEMA_VERSION;
  traceId: string;
  sequence: number;
  timestamp: string;
  context: ExtensionDebugTraceContext;
  category: ExtensionDebugTraceCategory;
  action: string;
  status: ExtensionDebugTraceStatus;
  durationMs?: number;
  providerId?: string;
  sourceId?: string;
  site?: string;
  host?: string;
  pathHash?: string;
  hasQuery?: boolean;
  titleHash?: string;
  conversationIdHash?: string;
  captureSignatureHash?: string;
  counts?: Record<string, number>;
  diagnosticCodes?: string[];
  byteEstimate?: number;
  error?: ExtensionDebugErrorSummary;
  metadata?: Record<string, string | number | boolean | readonly string[] | readonly number[]>;
  redactions: ExtensionDebugRedactionSummary;
}

export interface ExtensionDebugStorageSnapshot {
  enabled: boolean;
  retainedEvents: number;
  droppedEvents: number;
  maxEvents: number;
  estimatedBytes?: number;
  quotaBytes?: number;
}

export interface ExtensionDebugCaptureSummary {
  sourceId: string;
  site: string;
  importStatus: string;
  bodyState: string;
  messageCount: number;
  byteEstimate: number;
  capturedAt: string;
  updatedAt: string;
}

export interface ExtensionDebugCaptureStorageUsage {
  usageBytes?: number;
  quotaBytes?: number;
  usageRatio?: number;
  totalCaptures?: number;
  fullCaptures?: number;
  metadataOnlyCaptures?: number;
  mediaAssets?: number;
  mediaAssetBytes?: number;
}

export interface ExtensionDebugBridgeStatus {
  state: string;
  versionKnown?: boolean;
}

export interface ExtensionDebugFailureClassification {
  traceId: string;
  category: ExtensionDebugTraceCategory;
  action: string;
  status: ExtensionDebugTraceStatus;
  reason: string;
}

export interface ExtensionDebugReport {
  schemaVersion: typeof EXTENSION_DEBUG_SCHEMA_VERSION;
  generatedAt: string;
  extensionVersion: string;
  browser: {
    target: string;
    context: string;
  };
  events: ExtensionDebugTraceEvent[];
  captureSummaries: ExtensionDebugCaptureSummary[];
  captureStorage: ExtensionDebugCaptureStorageUsage;
  bridge: ExtensionDebugBridgeStatus;
  classifications: ExtensionDebugFailureClassification[];
  redactions: ExtensionDebugRedactionSummary;
  storage: ExtensionDebugStorageSnapshot;
}
