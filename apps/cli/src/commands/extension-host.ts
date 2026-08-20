import { readSync } from "node:fs";
import type { BrowserExtensionCapturePayload, ExtensionHostRequest, ExtensionHostResponse, MessageAttachment, MessageCitation, MessageMedia } from "@recallbase/contracts";
import type { ImportBatchInput } from "@recallbase/core";
import type { CommandContext } from "./shared";
import { encodeNativeMessage, parseNativeRequest, readNativeMessage } from "../extension/native-protocol";
import { assertSupportedBrowserCapture } from "../extension/supported-sites";
import packageJson from "../../../../package.json";

const RECALLBASE_VERSION = packageJson.version;

export async function extensionHostCommand(context: CommandContext): Promise<void> {
  const request = readNativeMessage((buffer, offset, length) => readSync(0, buffer, offset, length, null));
  const response = await handleExtensionHostRequest(context, request);
  await Bun.write(Bun.stdout, encodeNativeMessage(response));
}

export async function handleExtensionHostRequest(
  context: CommandContext,
  requestOrValue: ExtensionHostRequest | unknown
): Promise<ExtensionHostResponse> {
  try {
    const request = isNativeRequest(requestOrValue) ? requestOrValue : parseNativeRequest(requestOrValue);
    if (request.type === "health") {
      return {
        ok: true,
        type: "health",
        protocolVersion: 1,
        version: RECALLBASE_VERSION
      };
    }

    if (request.type === "status") {
      const sources = context.db.sources().filter((source) => !request.sourceId || source.id === request.sourceId);
      return { ok: true, type: "status", protocolVersion: 1, sources };
    }

    const batch = capturePayloadToImportBatch(request.payload);
    const result = context.db.importBatch(batch);
    return {
      ok: true,
      type: "import",
      protocolVersion: 1,
      result: {
        conversations: result.conversations,
        messages: result.messages,
        diagnostics: result.diagnostics,
        sourceId: request.payload.sourceId,
        captureSignature: request.payload.captureSignature
      }
    };
  } catch (error) {
    return {
      ok: false,
      type: "error",
      error: {
        code: "protocol_error",
        message: error instanceof Error ? error.message : "Native messaging request failed."
      }
    };
  }
}

export function capturePayloadToImportBatch(payload: BrowserExtensionCapturePayload): ImportBatchInput {
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(payload.sourceId)) throw new Error("Invalid sourceId.");
  assertSupportedBrowserCapture(payload);
  const safeSourceUrl = sanitizeMetadataUrl(payload.url) ?? payload.url;
  const evidenceUri = `browser-extension://captures/${encodeURIComponent(payload.captureSignature)}`;
  return {
    sourceId: payload.sourceId,
    sourceLabel: payload.sourceLabel,
    scope: "partial",
    confidence: "experimental",
    confidenceReason: "Browser extension native messaging payload schema v1.",
    schemaFingerprint: "browser-extension-native-message-v1",
    sourceVersion: payload.site,
    cursor: payload.captureSignature,
    diagnostics: payload.diagnostics,
    conversations: [
      {
        sourceId: payload.sourceId,
        sourceLabel: payload.sourceLabel,
        upstreamId: payload.upstreamConversationId,
        title: payload.title,
        startedAt: payload.startedAt,
        updatedAt: payload.updatedAt,
        rawEvidence: [],
        messages: payload.messages.map((message, index) => {
          const normalized = {
            upstreamId: message.upstreamId ?? `${payload.upstreamConversationId}:message:${index}`,
            ...(message.upstreamIds?.length ? { upstreamIds: message.upstreamIds } : {}),
            role: message.role,
            createdAt: message.createdAt,
            ...(message.updatedAt ? { updatedAt: message.updatedAt } : {}),
            text: sanitizeMarkdownImageUrls(message.text)
          };
          return {
            ...normalized,
            ...(message.thinking ? { thinking: sanitizeMarkdownImageUrls(message.thinking) } : {}),
            ...(message.modelId ? { modelId: message.modelId } : {}),
            ...safeAttachmentsMetadata(message.attachments),
            ...safeCitationsMetadata(message.citations),
            ...safeMediaMetadata(message.media)
          };
        }),
        diagnostics: payload.diagnostics,
        metadata: {
          url: safeSourceUrl,
          site: payload.site,
          capturedAt: payload.capturedAt,
          captureSignature: payload.captureSignature,
          evidenceUri,
          ...(payload.branch ? { branch: payload.branch } : {})
        }
      }
    ]
  };
}

function isNativeRequest(value: unknown): value is ExtensionHostRequest {
  return typeof value === "object" && value !== null && "type" in value && "protocolVersion" in value;
}

function safeAttachmentsMetadata(attachments: MessageAttachment[] | undefined): { attachments?: MessageAttachment[] } {
  const safe = (attachments ?? []).flatMap((item) => {
    const normalized: MessageAttachment = { name: item.name };
    if (item.id) normalized.id = item.id;
    if (item.mimeType) normalized.mimeType = item.mimeType;
    if (item.sizeBytes !== undefined) normalized.sizeBytes = item.sizeBytes;
    const url = item.url ? sanitizeAssetUrl(item.url) : undefined;
    if (item.url && !url) return [];
    if (url) normalized.url = url;
    if (item.width !== undefined) normalized.width = item.width;
    if (item.height !== undefined) normalized.height = item.height;
    if (item.source) normalized.source = item.source;
    return [normalized];
  });
  return safe.length > 0 ? { attachments: safe } : {};
}

function safeCitationsMetadata(citations: MessageCitation[] | undefined): { citations?: MessageCitation[] } {
  const safe = (citations ?? []).flatMap((citation) => {
    const url = sanitizeMetadataUrl(citation.url);
    if (!url) return [];
    return [{ ...citation, url }];
  });
  return safe.length > 0 ? { citations: safe } : {};
}

function safeMediaMetadata(media: MessageMedia[] | undefined): { media?: MessageMedia[] } {
  const safe = (media ?? []).flatMap((item) => {
    const url = item.url ? sanitizeAssetUrl(item.url) : undefined;
    if (item.url && !url) return [];
    const normalized: MessageMedia = { type: item.type };
    if (url) normalized.url = url;
    if (item.title) normalized.title = item.title;
    if (item.description) normalized.description = item.description;
    const thumbnailUrl = item.thumbnailUrl ? sanitizeAssetUrl(item.thumbnailUrl) : undefined;
    if (item.thumbnailUrl && !thumbnailUrl) return [];
    if (thumbnailUrl) normalized.thumbnailUrl = thumbnailUrl;
    if (item.duration) normalized.duration = item.duration;
    if (item.views !== undefined) normalized.views = item.views;
    if (item.uploadedAt) normalized.uploadedAt = item.uploadedAt;
    if (item.mimeType) normalized.mimeType = item.mimeType;
    if (item.source) normalized.source = item.source;
    return normalized.url || normalized.title ? [normalized] : [];
  });
  return safe.length > 0 ? { media: safe } : {};
}

function sanitizeMetadataUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
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

function sanitizeAssetUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
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

function sanitizeMarkdownImageUrls(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\(<([^>]*)>\)/g, (_match, label: string, rawUrl: string) => {
      const safe = sanitizeAssetUrl(unescapeMarkdownUrl(rawUrl.trim()).replace(/\s+"[^"]*"$/, "").trim());
      return safe ? `![${label}](<${safe}>)` : `![${label}](#recallbase-image-unavailable)`;
    })
    .replace(/!\[([^\]]*)\]\(((?:\\.|[^()\\]|\([^()]*\))+)\)/g, (match, label: string, rawUrl: string) => {
      const trimmed = rawUrl.trim();
      if (trimmed.startsWith("<")) return match;
      const safe = sanitizeAssetUrl(unescapeMarkdownUrl(trimmed).replace(/\s+"[^"]*"$/, "").trim());
      return safe ? `![${label}](${safe})` : `![${label}](#recallbase-image-unavailable)`;
    });
}

function unescapeMarkdownUrl(value: string): string {
  return value.replace(/\\([\\() ])/g, "$1");
}
