import { join, sep } from "node:path";
import type { ImportBatchInput, MessageRole, NormalizedConversationInput, NormalizedMessageInput } from "@recallbase/core";
import type { Diagnostic } from "@recallbase/contracts";
import { diagnostic } from "../common/diagnostics";
import { fileSchemaFingerprint, fileStem, findFiles, pathExists, schemaFingerprint, titleFromMessageTexts, userHome } from "../common/discovery";
import type { SourceDiscoveryResult, SourceImporter } from "../common/importer";
import { asObject, asString, readJsonl, textFromContent } from "../common/json";

const SOURCE_ID = "codex";
const SOURCE_LABEL = "Codex";

export function createCodexImporter(): SourceImporter {
  return {
    id: SOURCE_ID,
    label: SOURCE_LABEL,
    async discover(options = {}) {
      const roots = options.roots ?? [
        userHome(".codex", "sessions"),
        userHome(".codex", "archived_sessions")
      ];
      const paths = await findFiles(roots, isCodexSessionPath);
      const result: SourceDiscoveryResult = {
        id: SOURCE_ID,
        label: SOURCE_LABEL,
        paths,
        present: paths.length > 0,
        confidence: "stable",
        confidenceReason: "Fixture coverage matches Codex JSONL records with timestamp, type, and payload fields.",
        diagnostics: []
      };
      if (paths.length > 0) result.schemaFingerprint = await fileSchemaFingerprint(paths);
      return result;
    },
    importFromPaths(paths, options) {
      return importCodexPaths(paths, options?.discovery);
    }
  };
}

async function importCodexPaths(paths: string[], discovery?: SourceDiscoveryResult): Promise<ImportBatchInput> {
  const conversations: NormalizedConversationInput[] = [];
  const diagnostics: Diagnostic[] = [...(discovery?.diagnostics ?? [])];
  const fingerprints: unknown[] = [];
  const titleCandidates = await readCodexTitleCandidates(paths, diagnostics);

  for (const path of paths) {
    try {
      const read = await readJsonl(path, SOURCE_ID);
      diagnostics.push(...read.diagnostics);
      fingerprints.push(...read.records.slice(0, 10).map((record) => Object.keys(record.value).sort()));
      const conversation = normalizeCodexFile(path, read.records, diagnostics, titleCandidates);
      if (conversation) conversations.push(conversation);
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "error", "source_unreadable", `Could not read Codex source: ${errorMessage(error)}.`, path)
      );
    }
  }

  return {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    conversations,
    diagnostics,
    schemaFingerprint: discovery?.schemaFingerprint ?? schemaFingerprint(fingerprints),
    confidence: "stable",
    confidenceReason: "Fixture coverage matches Codex JSONL records with timestamp, type, and payload fields."
  };
}

function normalizeCodexFile(
  path: string,
  records: Array<{ value: Record<string, unknown>; raw: string; uri: string; line: number }>,
  diagnostics: Diagnostic[],
  titleCandidates = new Map<string, string[]>()
): NormalizedConversationInput | undefined {
  if (records.length === 0) return undefined;

  const messages: NormalizedMessageInput[] = [];
  const sessionId = codexSessionId(records[0]?.value) ?? fileStem(path);
  const fallbackTime = new Date(0).toISOString();
  let unmappedEvents = 0;

  for (const record of records) {
    const payload = asObject(record.value.payload);
    const messageObject = asObject(payload?.message) ?? asObject(record.value.message) ?? payload;
    const role = normalizeRole(asString(messageObject?.role) ?? asString(payload?.role) ?? asString(record.value.type));
    const text =
      textFromContent(messageObject?.content) ??
      textFromContent(messageObject?.text) ??
      textFromContent(payload?.content) ??
      textFromContent(payload?.text);

    if (!text) {
      if (asString(record.value.type) !== "session_meta") {
        unmappedEvents += 1;
      }
      continue;
    }
    if (!isImportableCodexRole(role)) {
      unmappedEvents += 1;
      continue;
    }

    messages.push({
      upstreamId: asString(record.value.id) ?? asString(payload?.id) ?? `L${record.line}`,
      role,
      createdAt: timestampFor(record.value, fallbackTime),
      text
    });
  }

  const uniqueMessages = dedupeMessages(messages);
  if (uniqueMessages.length === 0) {
    diagnostics.push(
      diagnostic(SOURCE_ID, "warning", "codex_no_messages", "Codex session had raw events but no importable messages.", path)
    );
    return undefined;
  }
  if (unmappedEvents > 0) {
    diagnostics.push(
      diagnostic(
        SOURCE_ID,
        "info",
        "codex_events_unmapped",
        `${unmappedEvents} Codex events were skipped because they did not contain importable messages.`,
        path
      )
    );
  }
  const times = uniqueMessages.map((message) => message.createdAt).sort();
  const startedAt = times[0] ?? timestampFor(records[0]!.value, fallbackTime);
  const updatedAt = times[times.length - 1] ?? startedAt;
  const sidecarTitleCandidates = titleCandidates.get(codexHistoryKey(sessionId)) ?? [];

  return {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    upstreamId: sessionId,
    title: titleFromMessageTexts(
      [
        ...sidecarTitleCandidates,
        ...uniqueMessages.filter((message) => message.role === "user").map((message) => message.text)
      ],
      uniqueMessages.map((message) => message.text),
      ""
    ),
    startedAt,
    updatedAt,
    messages: uniqueMessages,
    rawEvidence: [],
    metadata: {
      sourcePath: path,
      format: "jsonl",
      fixtureProvenance: "tests/fixtures/importers/codex"
    }
  };
}

async function readCodexTitleCandidates(paths: string[], diagnostics: Diagnostic[]): Promise<Map<string, string[]>> {
  const titles = new Map<string, string[]>();
  for (const historyPath of sidecarPathsFor(paths, "history.jsonl")) {
    if (!(await pathExists(historyPath))) continue;
    try {
      const read = await readJsonl(historyPath, SOURCE_ID);
      for (const record of read.records) {
        const sessionId = asString(record.value.session_id) ?? asString(record.value.sessionId);
        const text = asString(record.value.text);
        if (!sessionId || !text) continue;
        addTitleCandidate(titles, sessionId, text);
      }
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "warning", "codex_history_unreadable", `Could not read Codex history titles: ${errorMessage(error)}.`, historyPath)
      );
    }
  }
  for (const indexPath of sidecarPathsFor(paths, "session_index.jsonl")) {
    if (!(await pathExists(indexPath))) continue;
    try {
      const read = await readJsonl(indexPath, SOURCE_ID);
      for (const record of read.records) {
        const sessionId = asString(record.value.id);
        const title = asString(record.value.thread_name);
        if (!sessionId || !title) continue;
        addTitleCandidate(titles, sessionId, title);
      }
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "warning", "codex_session_index_unreadable", `Could not read Codex session index titles: ${errorMessage(error)}.`, indexPath)
      );
    }
  }
  return titles;
}

function addTitleCandidate(titles: Map<string, string[]>, sessionId: string, text: string): void {
  const key = codexHistoryKey(sessionId);
  const items = titles.get(key) ?? [];
  items.push(text);
  titles.set(key, items);
}

function sidecarPathsFor(paths: string[], filename: string): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    const parts = path.split(/[\\/]/);
    const codexIndex = parts.lastIndexOf(".codex");
    if (codexIndex === -1) continue;
    const prefix = path.startsWith(sep) ? sep : "";
    roots.add(join(prefix, ...parts.slice(0, codexIndex + 1)));
  }
  return [...roots].map((root) => join(root, filename));
}

function codexHistoryKey(sessionId: string): string {
  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(sessionId)?.[1];
  return (uuid ?? sessionId).toLowerCase();
}

function codexSessionId(record?: Record<string, unknown>): string | undefined {
  const payload = asObject(record?.payload);
  return asString(record?.sessionId) ?? asString(record?.session_id) ?? asString(payload?.sessionId) ?? asString(payload?.session_id);
}

function isCodexSessionPath(path: string): boolean {
  if (!path.endsWith(".jsonl")) return false;
  const parts = path.split(/[\\/]+/);
  return parts.some((part, index) => {
    if (part !== ".codex" && part !== "codex") return false;
    const next = parts[index + 1];
    return next === "sessions" || next === "archived_sessions";
  });
}

function timestampFor(record: Record<string, unknown>, fallback: string): string {
  const value = record.timestamp ?? record.createdAt ?? record.created_at;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return fallback;
}

function normalizeRole(value: string | undefined): MessageRole {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") return value;
  if (value === "function_call" || value === "tool_result") return "tool";
  return "unknown";
}

function isImportableCodexRole(role: MessageRole): boolean {
  return role === "user" || role === "assistant" || role === "system" || role === "tool";
}

function dedupeMessages(messages: NormalizedMessageInput[]): NormalizedMessageInput[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const key = `${message.role}\u001f${message.createdAt}\u001f${message.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
