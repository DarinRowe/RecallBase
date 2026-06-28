import { join, sep } from "node:path";
import type { ImportBatchInput, MessageRole, NormalizedConversationInput, NormalizedMessageInput } from "@recallbase/core";
import type { Diagnostic } from "@recallbase/contracts";
import { diagnostic } from "../common/diagnostics";
import { fileSchemaFingerprint, fileStem, findFiles, pathExists, schemaFingerprint, sessionTitleFallback, titleFromMessageTexts, userHome } from "../common/discovery";
import type { SourceDiscoveryResult, SourceImporter } from "../common/importer";
import { asObject, asString, readJsonl, textFromContent } from "../common/json";

const SOURCE_ID = "claude-code";
const SOURCE_LABEL = "Claude Code";

export function createClaudeCodeImporter(): SourceImporter {
  return {
    id: SOURCE_ID,
    label: SOURCE_LABEL,
    async discover(options = {}) {
      const roots = options.roots ?? [userHome(".claude", "projects")];
      const paths = await findFiles(
        roots,
        (path) => path.endsWith(".jsonl") && /(^|[\\/])(\.claude|claude-code)([\\/]|$)/.test(path)
      );
      const result: SourceDiscoveryResult = {
        id: SOURCE_ID,
        label: SOURCE_LABEL,
        paths,
        present: paths.length > 0,
        confidence: "stable",
        confidenceReason: "Fixture coverage matches Claude Code project JSONL records with sessionId, type, and message fields.",
        diagnostics: []
      };
      if (paths.length > 0) result.schemaFingerprint = await fileSchemaFingerprint(paths);
      return result;
    },
    importFromPaths(paths, options) {
      return importClaudeCodePaths(paths, options?.discovery);
    }
  };
}

async function importClaudeCodePaths(paths: string[], discovery?: SourceDiscoveryResult): Promise<ImportBatchInput> {
  const conversations: NormalizedConversationInput[] = [];
  const diagnostics: Diagnostic[] = [...(discovery?.diagnostics ?? [])];
  const fingerprints: unknown[] = [];
  const historyTitles = await readClaudeHistoryTitles(paths, diagnostics);

  for (const path of paths) {
    try {
      const read = await readJsonl(path, SOURCE_ID);
      diagnostics.push(...read.diagnostics);
      fingerprints.push(...read.records.slice(0, 10).map((record) => Object.keys(record.value).sort()));
      const grouped = groupBySession(path, read.records, diagnostics, historyTitles);
      conversations.push(...grouped);
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "error", "source_unreadable", `Could not read Claude Code source: ${errorMessage(error)}.`, path)
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
    confidenceReason: "Fixture coverage matches Claude Code project JSONL records with sessionId, type, and message fields."
  };
}

function groupBySession(
  path: string,
  records: Array<{ value: Record<string, unknown>; raw: string; uri: string; line: number }>,
  diagnostics: Diagnostic[],
  historyTitles = new Map<string, string[]>()
): NormalizedConversationInput[] {
  const groups = new Map<string, typeof records>();
  for (const record of records) {
    const sessionId = asString(record.value.sessionId) ?? asString(record.value.session_id) ?? fileStem(path);
    const group = groups.get(sessionId) ?? [];
    group.push(record);
    groups.set(sessionId, group);
  }

  return [...groups.entries()]
    .map(([sessionId, group]) => normalizeClaudeSession(path, sessionId, group, diagnostics, historyTitles))
    .filter((item): item is NormalizedConversationInput => item !== undefined);
}

function normalizeClaudeSession(
  path: string,
  sessionId: string,
  records: Array<{ value: Record<string, unknown>; raw: string; uri: string; line: number }>,
  diagnostics: Diagnostic[],
  historyTitles = new Map<string, string[]>()
): NormalizedConversationInput | undefined {
  if (records.length === 0) return undefined;
  const messages: NormalizedMessageInput[] = [];
  const fallbackTime = new Date(0).toISOString();
  let unmappedEvents = 0;

  for (const record of records) {
    const message = asObject(record.value.message);
    const role = normalizeRecordRole(record.value, message);
    const text =
      textFromContent(message?.content) ??
      textFromContent(record.value.content) ??
      textFromContent(record.value.text) ??
      textFromContent(record.value.summary);

    if (!text) {
      unmappedEvents += 1;
      continue;
    }

    messages.push({
      upstreamId: asString(record.value.uuid) ?? asString(record.value.id) ?? `L${record.line}`,
      role,
      createdAt: timestampFor(record.value, fallbackTime),
      text
    });
  }

  const uniqueMessages = dedupeMessages(messages);
  if (unmappedEvents > 0) {
    diagnostics.push(
      diagnostic(
        SOURCE_ID,
        "info",
        "claude_code_events_unmapped",
        `${unmappedEvents} Claude Code events were skipped because they did not contain importable messages.`,
        path
      )
    );
  }
  if (uniqueMessages.length === 0) {
    diagnostics.push(
      diagnostic(SOURCE_ID, "warning", "claude_code_no_messages", "Claude Code session had raw events but no importable messages.", path)
    );
    return undefined;
  }
  const times = uniqueMessages.map((message) => message.createdAt).sort();
  const startedAt = times[0] ?? timestampFor(records[0]!.value, fallbackTime);
  const updatedAt = times[times.length - 1] ?? startedAt;
  const historyTitleCandidates = historyTitles.get(sessionId) ?? [];

  return {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    upstreamId: sessionId,
    title: titleFromMessageTexts(
      [
        ...historyTitleCandidates,
        ...uniqueMessages.filter((message) => message.role === "user").map((message) => message.text)
      ],
      uniqueMessages.map((message) => message.text),
      sessionTitleFallback(SOURCE_LABEL, sessionId)
    ),
    startedAt,
    updatedAt,
    messages: uniqueMessages,
    rawEvidence: [],
    metadata: {
      sourcePath: path,
      format: "jsonl",
      project: fileStem(path),
      fixtureProvenance: "tests/fixtures/importers/claude-code"
    }
  };
}

async function readClaudeHistoryTitles(paths: string[], diagnostics: Diagnostic[]): Promise<Map<string, string[]>> {
  const titles = new Map<string, string[]>();
  for (const historyPath of historyPathsFor(paths)) {
    if (!(await pathExists(historyPath))) continue;
    try {
      const read = await readJsonl(historyPath, SOURCE_ID);
      for (const record of read.records) {
        const sessionId = asString(record.value.sessionId) ?? asString(record.value.session_id);
        const text = asString(record.value.display);
        if (!sessionId || !text) continue;
        const items = titles.get(sessionId) ?? [];
        items.push(text);
        titles.set(sessionId, items);
      }
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "warning", "claude_code_history_unreadable", `Could not read Claude Code history titles: ${errorMessage(error)}.`, historyPath)
      );
    }
  }
  return titles;
}

function historyPathsFor(paths: string[]): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    const parts = path.split(/[\\/]/);
    const claudeIndex = parts.lastIndexOf(".claude");
    if (claudeIndex === -1) continue;
    const prefix = path.startsWith(sep) ? sep : "";
    roots.add(join(prefix, ...parts.slice(0, claudeIndex + 1)));
  }
  return [...roots].map((root) => join(root, "history.jsonl"));
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
  if (value === "tool_result") return "tool";
  return "unknown";
}

function normalizeRecordRole(record: Record<string, unknown>, message: Record<string, unknown> | undefined): MessageRole {
  if (asString(record.type) === "queue-operation" && asString(record.operation) === "enqueue") return "user";
  return normalizeRole(asString(message?.role) ?? asString(record.type));
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
