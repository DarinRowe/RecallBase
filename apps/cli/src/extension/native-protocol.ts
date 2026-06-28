import type { BrowserExtensionCapturePayload, ExtensionHostRequest, ExtensionHostResponse, MessageAttachment, MessageCitation, MessageMedia } from "@recallbase/contracts";

const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;

export function encodeNativeMessage(message: ExtensionHostResponse | ExtensionHostRequest): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(message));
  if (body.byteLength > MAX_NATIVE_MESSAGE_BYTES) throw new Error("Native message is too large.");
  const framed = new Uint8Array(4 + body.byteLength);
  new DataView(framed.buffer).setUint32(0, body.byteLength, true);
  framed.set(body, 4);
  return framed;
}

export function decodeNativeMessage(bytes: Uint8Array): ExtensionHostRequest {
  if (bytes.byteLength < 4) throw new Error("Native message is missing a length prefix.");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (length > MAX_NATIVE_MESSAGE_BYTES) throw new Error("Native message is too large.");
  if (bytes.byteLength - 4 < length) throw new Error("Native message ended before the declared length.");
  return parseNativeRequest(JSON.parse(new TextDecoder().decode(bytes.slice(4, 4 + length))));
}

export function readNativeMessage(read: (buffer: Uint8Array, offset: number, length: number) => number): ExtensionHostRequest {
  const header = readExact(read, 4);
  const length = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0, true);
  if (length > MAX_NATIVE_MESSAGE_BYTES) throw new Error("Native message is too large.");
  const body = readExact(read, length);
  const framed = new Uint8Array(4 + body.byteLength);
  framed.set(header, 0);
  framed.set(body, 4);
  return decodeNativeMessage(framed);
}

export function parseNativeRequest(value: unknown): ExtensionHostRequest {
  if (!isRecord(value) || value.protocolVersion !== 1 || typeof value.type !== "string") {
    throw new Error("Unsupported native messaging request.");
  }
  if (value.type === "health") return { type: "health", protocolVersion: 1 };
  if (value.type === "status") {
    const request: ExtensionHostRequest = { type: "status", protocolVersion: 1 };
    if (typeof value.sourceId === "string") request.sourceId = value.sourceId;
    return request;
  }
  if (value.type === "import") {
    const payload = parseCapturePayload(value.payload);
    return { type: "import", protocolVersion: 1, payload };
  }
  throw new Error("Unsupported native messaging request type.");
}

function parseCapturePayload(value: unknown): BrowserExtensionCapturePayload {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("Unsupported browser capture payload.");
  const messages = readArray(value.messages, "messages").map((message) => {
    if (!isRecord(message)) throw new Error("Browser capture message must be an object.");
    const parsed = {
      role: readString(message.role, "message.role"),
      createdAt: readIsoDate(message.createdAt, "message.createdAt"),
      text: sanitizeNativeMarkdownImageUrls(readMessageText(message.text, "message.text"))
    } as BrowserExtensionCapturePayload["messages"][number];
    if (!["user", "assistant", "system", "tool", "unknown"].includes(parsed.role)) throw new Error("Unsupported browser capture message role.");
    if (typeof message.upstreamId === "string") parsed.upstreamId = message.upstreamId;
    const upstreamIds = parseStringList(message.upstreamIds, "message.upstreamIds");
    if (upstreamIds.length > 0) parsed.upstreamIds = upstreamIds;
    if (typeof message.updatedAt === "string") parsed.updatedAt = readIsoDate(message.updatedAt, "message.updatedAt");
    if (typeof message.thinking === "string" && message.thinking.trim().length > 0) parsed.thinking = sanitizeNativeMarkdownImageUrls(message.thinking);
    if (typeof message.modelId === "string" && message.modelId.trim().length > 0) parsed.modelId = message.modelId.trim();
    const attachments = parseAttachments(message.attachments);
    const citations = parseCitations(message.citations);
    const media = parseMedia(message.media);
    if (attachments.length > 0) parsed.attachments = attachments;
    if (citations.length > 0) parsed.citations = citations;
    if (media.length > 0) parsed.media = media;
    return parsed;
  });
  const diagnostics = readArray(value.diagnostics ?? [], "diagnostics").map((diagnostic) => {
    if (!isRecord(diagnostic)) throw new Error("Browser capture diagnostic must be an object.");
    const parsed = {
      severity: readString(diagnostic.severity, "diagnostic.severity"),
      code: readString(diagnostic.code, "diagnostic.code"),
      message: readString(diagnostic.message, "diagnostic.message")
    } as { severity: "info" | "warning" | "error"; code: string; message: string; sourceId?: string; evidenceRef?: string };
    if (!["info", "warning", "error"].includes(parsed.severity)) throw new Error("Unsupported diagnostic severity.");
    if (typeof diagnostic.sourceId === "string") parsed.sourceId = diagnostic.sourceId;
    if (typeof diagnostic.evidenceRef === "string") parsed.evidenceRef = diagnostic.evidenceRef;
    return parsed;
  });
  const payload: BrowserExtensionCapturePayload = {
    schemaVersion: 1,
    sourceId: readId(value.sourceId, "sourceId"),
    sourceLabel: readString(value.sourceLabel, "sourceLabel"),
    site: readString(value.site, "site"),
    upstreamConversationId: readString(value.upstreamConversationId, "upstreamConversationId"),
    url: readCaptureUrl(value.url, "url"),
    title: readString(value.title, "title"),
    capturedAt: readIsoDate(value.capturedAt, "capturedAt"),
    startedAt: readIsoDate(value.startedAt, "startedAt"),
    updatedAt: readIsoDate(value.updatedAt, "updatedAt"),
    messages,
    diagnostics,
    captureSignature: readString(value.captureSignature, "captureSignature")
  };
  const branch = parseBranch(value.branch);
  if (branch) payload.branch = branch;
  return payload;
}

function parseBranch(value: unknown): BrowserExtensionCapturePayload["branch"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Browser capture branch must be an object.");
  const leafId = readString(value.leafId, "branch.leafId");
  const pathIds = parseStringList(value.pathIds, "branch.pathIds");
  if (pathIds.length === 0) throw new Error("Invalid branch.pathIds.");
  const branch: NonNullable<BrowserExtensionCapturePayload["branch"]> = { leafId, pathIds };
  if (typeof value.createdAt === "string") branch.createdAt = readIsoDate(value.createdAt, "branch.createdAt");
  return branch;
}

function parseStringList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error(`Invalid ${label}.`);
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 256 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function readId(value: unknown, label: string): string {
  const id = readString(value, label);
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(id)) throw new Error(`Invalid ${label}.`);
  return id;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${label}.`);
  return value;
}

function readMessageText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Invalid ${label}.`);
  return value;
}

function sanitizeNativeMarkdownImageUrls(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\(<([^>]*)>\)/g, (_match, label: string, rawUrl: string) => {
      const safe = sanitizeNativeAssetUrl(unescapeMarkdownUrl(rawUrl.trim()).replace(/\s+"[^"]*"$/, "").trim());
      return safe ? `![${label}](<${safe}>)` : `![${label}](#recallbase-image-unavailable)`;
    })
    .replace(/!\[([^\]]*)\]\(((?:\\.|[^()\\]|\([^()]*\))+)\)/g, (match, label: string, rawUrl: string) => {
      const trimmed = rawUrl.trim();
      if (trimmed.startsWith("<")) return match;
      const safe = sanitizeNativeAssetUrl(unescapeMarkdownUrl(trimmed).replace(/\s+"[^"]*"$/, "").trim());
      return safe ? `![${label}](${safe})` : `![${label}](#recallbase-image-unavailable)`;
    });
}

function unescapeMarkdownUrl(value: string): string {
  return value.replace(/\\([\\() ])/g, "$1");
}

function readIsoDate(value: unknown, label: string): string {
  const raw = readString(value, label);
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${label}.`);
  return new Date(timestamp).toISOString();
}

function readCaptureUrl(value: unknown, label: string): string {
  const sanitized = sanitizeNativeUrl(readString(value, label));
  if (!sanitized) throw new Error(`Invalid ${label}.`);
  return sanitized;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function parseAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = optionalTrimmedString(item.name);
    if (!name) return [];
    const attachment: MessageAttachment = { name };
    const id = optionalTrimmedString(item.id);
    const mimeType = optionalTrimmedString(item.mimeType);
    const source = optionalTrimmedString(item.source);
    const sizeBytes = typeof item.sizeBytes === "number" && Number.isFinite(item.sizeBytes) && item.sizeBytes >= 0 ? item.sizeBytes : undefined;
    const url = sanitizeNativeAssetUrl(item.url);
    const width = typeof item.width === "number" && Number.isFinite(item.width) && item.width >= 0 ? item.width : undefined;
    const height = typeof item.height === "number" && Number.isFinite(item.height) && item.height >= 0 ? item.height : undefined;
    if (id) attachment.id = id;
    if (mimeType) attachment.mimeType = mimeType;
    if (source) attachment.source = source;
    if (sizeBytes !== undefined) attachment.sizeBytes = sizeBytes;
    if (url) attachment.url = url;
    if (width !== undefined) attachment.width = width;
    if (height !== undefined) attachment.height = height;
    return [attachment];
  });
}

function parseCitations(value: unknown): MessageCitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const url = sanitizeNativeUrl(item.url);
    if (!url) return [];
    const citation: MessageCitation = { url };
    const title = optionalTrimmedString(item.title);
    const source = optionalTrimmedString(item.source);
    if (title) citation.title = title;
    if (source) citation.source = source;
    return [citation];
  });
}

function parseMedia(value: unknown): MessageMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const rawType = optionalTrimmedString(item.type);
    const type: MessageMedia["type"] = rawType === "image" || rawType === "video" || rawType === "file" || rawType === "unknown" ? rawType : "unknown";
    const media: MessageMedia = { type };
    const url = sanitizeNativeAssetUrl(item.url);
    const title = optionalTrimmedString(item.title);
    const description = optionalTrimmedString(item.description);
    const thumbnailUrl = sanitizeNativeAssetUrl(item.thumbnailUrl);
    const duration = optionalTrimmedString(item.duration);
    const views = typeof item.views === "number" && Number.isFinite(item.views) && item.views >= 0 ? item.views : undefined;
    const uploadedAt = optionalTrimmedString(item.uploadedAt);
    const mimeType = optionalTrimmedString(item.mimeType);
    const source = optionalTrimmedString(item.source);
    if (url) media.url = url;
    if (title) media.title = title;
    if (description) media.description = description;
    if (thumbnailUrl) media.thumbnailUrl = thumbnailUrl;
    if (duration) media.duration = duration;
    if (views !== undefined) media.views = views;
    if (uploadedAt) media.uploadedAt = uploadedAt;
    if (mimeType) media.mimeType = mimeType;
    if (source) media.source = source;
    return media.url || media.title ? [media] : [];
  });
}

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeNativeUrl(value: unknown): string | undefined {
  const raw = optionalTrimmedString(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function sanitizeNativeAssetUrl(value: unknown): string | undefined {
  const raw = optionalTrimmedString(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function readExact(read: (buffer: Uint8Array, offset: number, length: number) => number, length: number): Uint8Array {
  const buffer = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = read(buffer, offset, length - offset);
    if (bytesRead <= 0) throw new Error("Native message ended before the declared length.");
    offset += bytesRead;
  }
  return buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
