import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import type { ImportBatchInput, MessageRole, NormalizedConversationInput, NormalizedMessageInput } from "@recallbase/core";
import type { Diagnostic } from "@recallbase/contracts";
import { diagnostic } from "../common/diagnostics";
import { fileSchemaFingerprint, fileUri, findFiles, schemaFingerprint, titleFromText, userHome } from "../common/discovery";
import type { SourceDiscoveryResult, SourceImporter } from "../common/importer";
import { asArray, asIsoDate, asObject, asString, textFromContent } from "../common/json";

const SOURCE_ID = "claude-web";
const SOURCE_LABEL = "Claude Web";
const CONVERSATIONS_PER_BATCH = 100;

export function createClaudeWebImporter(): SourceImporter {
  return {
    id: SOURCE_ID,
    label: SOURCE_LABEL,
    async discover(options = {}) {
      const roots = options.roots ?? [userHome("Downloads")];
      const candidates = await findFiles(roots, isClaudeWebExportCandidate, options.roots ? 6 : 2);
      const paths = [];
      for (const path of candidates) {
        if (await looksLikeClaudeWebExport(path)) paths.push(path);
      }
      const result: SourceDiscoveryResult = {
        id: SOURCE_ID,
        label: SOURCE_LABEL,
        paths,
        present: paths.length > 0,
        confidence: "experimental",
        confidenceReason: "Fixture coverage matches Claude web export conversations.json arrays with chat_messages.",
        diagnostics: []
      };
      if (paths.length > 0) result.schemaFingerprint = await fileSchemaFingerprint(paths);
      return result;
    },
    importFromPaths(paths, options) {
      return importClaudeWebPaths(paths, options?.discovery);
    },
    importBatchesFromPaths(paths, options) {
      return importClaudeWebBatches(paths, options?.discovery);
    }
  };
}

function isClaudeWebExportCandidate(path: string): boolean {
  return basename(path) === "conversations.json";
}

async function looksLikeClaudeWebExport(path: string): Promise<boolean> {
  let file;
  try {
    file = await open(path, "r");
    const buffer = Buffer.alloc(128 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead).toString("utf8");
    return (
      /^\s*\[/.test(sample) &&
      sample.includes('"uuid"') &&
      sample.includes('"chat_messages"') &&
      (sample.includes('"sender"') || sample.includes('"summary"') || sample.includes('"name"') || sample.includes('"created_at"'))
    );
  } catch {
    return false;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

async function importClaudeWebPaths(paths: string[], discovery?: SourceDiscoveryResult): Promise<ImportBatchInput> {
  const conversations: NormalizedConversationInput[] = [];
  const diagnostics: Diagnostic[] = [];
  const fingerprints: unknown[] = [];

  for await (const batch of importClaudeWebBatches(paths, discovery)) {
    conversations.push(...batch.conversations);
    diagnostics.push(...(batch.diagnostics ?? []));
    if (batch.schemaFingerprint) fingerprints.push(batch.schemaFingerprint);
  }

  return {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    conversations,
    diagnostics,
    schemaFingerprint: discovery?.schemaFingerprint ?? schemaFingerprint(fingerprints),
    confidence: "experimental",
    confidenceReason: "Fixture coverage matches Claude web export conversations.json arrays with chat_messages."
  };
}

async function* importClaudeWebBatches(paths: string[], discovery?: SourceDiscoveryResult): AsyncIterable<ImportBatchInput> {
  let conversations: NormalizedConversationInput[] = [];
  let diagnostics: Diagnostic[] = [...(discovery?.diagnostics ?? [])];
  const fingerprints: unknown[] = [];
  let emitted = false;

  for (const path of paths) {
    try {
      for await (const rawConversation of streamTopLevelJsonObjects(path)) {
        const item = JSON.parse(rawConversation) as unknown;
        if (fingerprints.length < 10) fingerprints.push(Object.keys(asObject(item) ?? {}).sort());
        const conversation = normalizeClaudeWebConversation(path, item, diagnostics);
        if (conversation) conversations.push(conversation);
        if (conversations.length >= CONVERSATIONS_PER_BATCH) {
          yield claudeWebBatch(conversations, diagnostics, discovery, fingerprints);
          emitted = true;
          conversations = [];
          diagnostics = [];
        }
      }
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "error", "source_unreadable", `Could not read Claude web export: ${errorMessage(error)}.`, path)
      );
    }
  }

  if (emitted || conversations.length > 0 || diagnostics.length > 0) {
    yield claudeWebBatch(conversations, diagnostics, discovery, fingerprints);
    return;
  }

  yield claudeWebBatch([], [], discovery, fingerprints);
}

function claudeWebBatch(
  conversations: NormalizedConversationInput[],
  diagnostics: Diagnostic[],
  discovery: SourceDiscoveryResult | undefined,
  fingerprints: unknown[]
): ImportBatchInput {
  return {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    conversations,
    diagnostics,
    schemaFingerprint: discovery?.schemaFingerprint ?? schemaFingerprint(fingerprints),
    confidence: "experimental",
    confidenceReason: "Fixture coverage matches Claude web export conversations.json arrays with chat_messages."
  };
}

function normalizeClaudeWebConversation(
  path: string,
  value: unknown,
  diagnostics: Diagnostic[]
): NormalizedConversationInput | undefined {
  const conversation = asObject(value);
  const upstreamId = asString(conversation?.uuid);
  const rawUri = fileUri(path, upstreamId ? `#conversation=${encodeURIComponent(upstreamId)}` : undefined);
  if (!conversation || !upstreamId) {
    diagnostics.push(diagnostic(SOURCE_ID, "warning", "claude_web_conversation_invalid", "Claude web conversation is missing uuid.", rawUri));
    return undefined;
  }

  const messages = dedupeMessages(asArray(conversation.chat_messages)
    .map((message, index) => normalizeClaudeWebMessage(message, index, conversation))
    .filter((message): message is NormalizedMessageInput => message !== undefined));
  if (messages.length === 0) {
    diagnostics.push(
      diagnostic(SOURCE_ID, "warning", "claude_web_no_messages", "Claude web conversation had no importable messages.", rawUri)
    );
    return undefined;
  }

  const messageTimes = messages.map((message) => message.createdAt).sort();
  const startedAt = asIsoDate(conversation.created_at, messageTimes[0] ?? new Date(0).toISOString());
  const updatedAt = asIsoDate(conversation.updated_at, messageTimes[messageTimes.length - 1] ?? startedAt);
  const firstUserText = messages.find((message) => message.role === "user")?.text;
  const title = titleFromText(
    asString(conversation.name) ?? asString(conversation.summary) ?? firstUserText ?? messages[0]?.text ?? "",
    `Claude Web ${upstreamId}`
  );

  return {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    upstreamId,
    title,
    startedAt,
    updatedAt,
    messages,
    rawEvidence: [],
    metadata: {
      sourcePath: path,
      format: "claude-web-export-json",
      fixtureProvenance: "tests/fixtures/importers/claude-web"
    }
  };
}

function normalizeClaudeWebMessage(
  value: unknown,
  index: number,
  conversation: Record<string, unknown>
): NormalizedMessageInput | undefined {
  const message = asObject(value);
  if (!message) return undefined;
  const text = textFromVisibleContent(message.content) ?? asString(message.text);
  if (!text) return undefined;

  return {
    upstreamId: asString(message.uuid) ?? `message-${index + 1}`,
    role: normalizeRole(asString(message.sender)),
    createdAt: asIsoDate(message.created_at ?? message.updated_at, asIsoDate(conversation.created_at, new Date(0).toISOString())),
    text
  };
}

function textFromVisibleContent(value: unknown): string | undefined {
  const items = asArray(value);
  if (items.length === 0) return textFromContent(value);
  const text = items
    .map((item) => {
      const object = asObject(item);
      if (!object) return typeof item === "string" ? item : undefined;
      const type = asString(object.type);
      if (type && type !== "text") return undefined;
      return asString(object.text) ?? asString(object.value) ?? asString(object.content);
    })
    .filter((item): item is string => Boolean(item))
    .join("\n")
    .trim();
  return text || undefined;
}

function normalizeRole(value: string | undefined): MessageRole {
  if (value === "human" || value === "user") return "user";
  if (value === "assistant") return "assistant";
  if (value === "system") return "system";
  if (value === "tool") return "tool";
  return "unknown";
}

function dedupeMessages(messages: NormalizedMessageInput[]): NormalizedMessageInput[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = `${message.upstreamId}\u001f${message.role}\u001f${message.createdAt}\u001f${message.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function* streamTopLevelJsonObjects(path: string): AsyncIterable<string> {
  const stream = createReadStream(path);
  const decoder = new TextDecoder();
  let state: "before_array" | "between_items" | "in_object" | "after_array" = "before_array";
  let objectText = "";
  let depth = 0;
  let inString = false;
  let escaped = false;

  function processText(text: string): string[] {
    const completed: string[] = [];
    for (const char of text) {
      if (state === "before_array") {
        if (/\s/.test(char)) continue;
        if (char !== "[") throw new Error("Claude web export conversations.json must contain a top-level array.");
        state = "between_items";
        continue;
      }

      if (state === "between_items") {
        if (/\s/.test(char) || char === ",") continue;
        if (char === "]") {
          state = "after_array";
          continue;
        }
        if (char !== "{") throw new Error("Claude web export top-level array must contain conversation objects.");
        state = "in_object";
        objectText = "{";
        depth = 1;
        inString = false;
        escaped = false;
        continue;
      }

      if (state === "after_array") {
        if (/\s/.test(char)) continue;
        throw new Error("Claude web export has trailing content after the top-level array.");
      }

      objectText += char;
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          completed.push(objectText);
          objectText = "";
          state = "between_items";
        } else if (depth < 0) {
          throw new Error("Claude web export contains unbalanced braces.");
        }
      }
    }
    return completed;
  }

  for await (const chunk of stream) {
    const text = decoder.decode(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)), { stream: true });
    for (const object of processText(text)) yield object;
  }

  const tail = decoder.decode();
  for (const object of processText(tail)) yield object;
  if (state === "before_array") throw new Error("Claude web export conversations.json is empty.");
  if (state === "in_object") throw new Error("Claude web export ended before a conversation object was complete.");
  if (state === "between_items") throw new Error("Claude web export ended before the top-level array was complete.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
