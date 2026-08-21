import { createReadStream } from "node:fs";
import { lstat, open, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { ImportBatchInput, NormalizedConversationInput, NormalizedMessageInput } from "@recallbase/core";
import type { Diagnostic } from "@recallbase/contracts";
import { diagnostic } from "../common/diagnostics";
import { schemaFingerprint, sessionTitleFallback, titleFromMessageTexts, userHome } from "../common/discovery";
import type { SourceDiscoveryResult, SourceImporter } from "../common/importer";
import { asArray, asObject } from "../common/json";

const SOURCE_ID = "cursor";
const SOURCE_LABEL = "Cursor";
const CONFIDENCE_REASON =
  "Fixture coverage follows the unified main-agent JSONL transcripts observed in Cursor Desktop 3.15.6 and Agent CLI 2026.08.04-aaa8809.";
const FIXTURE_PROVENANCE = "tests/fixtures/importers/cursor";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KNOWN_EXCLUDED_BLOCK_TYPES = new Set(["tool_use"]);

interface TranscriptCandidate {
  conversation?: NormalizedConversationInput;
  completeMessageRecords: number;
  mtimeMs: number;
  fingerprint: Record<string, Record<string, true>>;
  trailingIncomplete: boolean;
  unknownBlockTypes: Set<string>;
  invalid: boolean;
  unreadable: boolean;
}

interface ImportCounters {
  duplicates: number;
  invalid: number;
  noMessages: number;
  trailingIncomplete: number;
  unknownSchema: number;
  unreadable: number;
}

export function createCursorImporter(): SourceImporter {
  return {
    id: SOURCE_ID,
    label: SOURCE_LABEL,
    async discover(options = {}) {
      const roots = options.roots ?? [userHome(".cursor", "projects")];
      const paths = await findCursorTranscripts(roots);
      const diagnostics: Diagnostic[] = [];
      if (paths.length > 0) {
        diagnostics.push(
          diagnostic(
            SOURCE_ID,
            "info",
            "cursor_experimental",
            "Cursor import is experimental because Cursor does not publish the content schema of its local transcript JSONL files."
          )
        );
      }
      return {
        id: SOURCE_ID,
        label: SOURCE_LABEL,
        paths,
        present: paths.length > 0,
        confidence: "experimental",
        confidenceReason: CONFIDENCE_REASON,
        diagnostics,
        fixtureProvenance: FIXTURE_PROVENANCE
      };
    },
    importFromPaths(paths, options) {
      return importCursorPaths(paths, options?.discovery);
    }
  };
}

async function findCursorTranscripts(roots: string[]): Promise<string[]> {
  const found = new Set<string>();
  const seen = new Set<string>();

  async function visit(input: string, depth: number): Promise<void> {
    if (depth > 5) return;
    const path = resolve(input);
    if (seen.has(path)) return;
    seen.add(path);
    let info;
    try {
      info = await lstat(path);
    } catch {
      return;
    }
    if (info.isSymbolicLink()) return;
    if (info.isFile()) {
      if (isMainTranscript(path)) found.add(path);
      return;
    }
    if (!info.isDirectory() || basename(path) === "subagents") return;
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === "subagents" || entry.name === "node_modules" || entry.name === ".git") continue;
      await visit(join(path, entry.name), depth + 1);
    }
  }

  for (const root of roots) await visit(root, 0);
  return [...found].sort();
}

function isMainTranscript(path: string): boolean {
  if (extname(path) !== ".jsonl") return false;
  const id = basename(path, ".jsonl");
  return UUID.test(id) && basename(dirname(path)) === id && basename(dirname(dirname(path))) === "agent-transcripts";
}

async function importCursorPaths(paths: string[], discovery?: SourceDiscoveryResult): Promise<ImportBatchInput> {
  const diagnostics = [...(discovery?.diagnostics ?? [])];
  const candidatesById = new Map<string, TranscriptCandidate[]>();
  const fingerprints: Array<Record<string, Record<string, true>>> = [];
  const counters: ImportCounters = {
    duplicates: 0,
    invalid: 0,
    noMessages: 0,
    trailingIncomplete: 0,
    unknownSchema: 0,
    unreadable: 0
  };

  for (const path of [...new Set(paths)].filter(isMainTranscript).sort()) {
    const candidate = await parseTranscript(path);
    fingerprints.push(candidate.fingerprint);
    if (candidate.trailingIncomplete) counters.trailingIncomplete += 1;
    if (candidate.unknownBlockTypes.size > 0) counters.unknownSchema += 1;
    if (candidate.invalid) counters.invalid += 1;
    if (candidate.unreadable) counters.unreadable += 1;
    if (!candidate.invalid && !candidate.unreadable && !candidate.conversation) counters.noMessages += 1;
    const id = basename(path, ".jsonl");
    const group = candidatesById.get(id) ?? [];
    group.push(candidate);
    candidatesById.set(id, group);
  }

  const conversations: NormalizedConversationInput[] = [];
  for (const candidates of candidatesById.values()) {
    const valid = candidates.filter((candidate) => candidate.conversation !== undefined && !candidate.invalid && !candidate.unreadable);
    valid.sort((left, right) => right.completeMessageRecords - left.completeMessageRecords || right.mtimeMs - left.mtimeMs);
    if (valid[0]?.conversation) conversations.push(valid[0].conversation);
    counters.duplicates += Math.max(0, candidates.length - 1);
  }
  conversations.sort((left, right) => left.startedAt.localeCompare(right.startedAt) || (left.upstreamId ?? "").localeCompare(right.upstreamId ?? ""));

  appendBoundedDiagnostics(diagnostics, counters);
  const batch: ImportBatchInput = {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    conversations,
    diagnostics,
    confidence: "experimental",
    confidenceReason: CONFIDENCE_REASON
  };
  if (fingerprints.length > 0) batch.schemaFingerprint = schemaFingerprint(fingerprints);
  return batch;
}

async function parseTranscript(path: string): Promise<TranscriptCandidate> {
  const topLevelKeys = new Set<string>();
  const roles = new Set<string>();
  const contentTypes = new Set<string>();
  const unknownBlockTypes = new Set<string>();
  const messages: NormalizedMessageInput[] = [];
  let completeMessageRecords = 0;
  let invalid = false;
  let unreadable = false;
  let trailingIncomplete = false;
  let mtimeMs = 0;

  try {
    const fileInfo = await stat(path);
    mtimeMs = fileInfo.mtimeMs;
    const initialSize = fileInfo.size;
    const endsWithNewline = await fileEndsWithNewline(path, initialSize);
    if (initialSize > 0) {
      const input = createReadStream(path, { encoding: "utf8", start: 0, end: initialSize - 1 });
      const lines = createInterface({ input, crlfDelay: Infinity });
      let lineNumber = 0;
      let pendingMalformed = false;
      for await (const line of lines) {
        lineNumber += 1;
        if (!line.trim()) continue;
        if (pendingMalformed) {
          invalid = true;
          break;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line) as unknown;
        } catch {
          pendingMalformed = true;
          continue;
        }
        const record = asObject(parsed);
        if (!record) continue;
        for (const key of Object.keys(record)) topLevelKeys.add(key);
        const role = typeof record.role === "string" ? record.role : undefined;
        if (role) roles.add(role);
        if (role !== "user" && role !== "assistant") continue;
        const message = asObject(record.message);
        if (!message || !Array.isArray(message.content)) {
          invalid = true;
          break;
        }
        const textParts: string[] = [];
        for (const item of asArray(message.content)) {
          const block = asObject(item);
          if (!block) {
            invalid = true;
            break;
          }
          const type = typeof block.type === "string" ? block.type : undefined;
          if (type) contentTypes.add(type);
          if (type === "text") {
            if (typeof block.text !== "string") {
              invalid = true;
              break;
            }
            const text = block.text.trim();
            if (text) textParts.push(text);
          } else if (type && !KNOWN_EXCLUDED_BLOCK_TYPES.has(type)) {
            unknownBlockTypes.add(type);
          }
        }
        if (invalid) break;
        const text = textParts.join("\n").trim();
        if (!text) continue;
        completeMessageRecords += 1;
        messages.push({
          upstreamId: `line:${lineNumber}`,
          role,
          createdAt: new Date(mtimeMs).toISOString(),
          text
        });
      }
      if (!invalid && pendingMalformed) {
        if (endsWithNewline) invalid = true;
        else trailingIncomplete = true;
      }
    }
  } catch {
    unreadable = true;
  }

  const fingerprint = {
    topLevelKeys: setFingerprint(topLevelKeys),
    roles: setFingerprint(roles),
    contentTypes: setFingerprint(contentTypes)
  };
  if (invalid || unreadable || messages.length === 0) {
    return { completeMessageRecords, mtimeMs, fingerprint, trailingIncomplete, unknownBlockTypes, invalid, unreadable };
  }

  const id = basename(path, ".jsonl");
  const timestamp = new Date(mtimeMs).toISOString();
  const firstUser = messages.find((message) => message.role === "user")?.text;
  return {
    conversation: {
      sourceId: SOURCE_ID,
      sourceLabel: SOURCE_LABEL,
      upstreamId: id,
      title: titleFromMessageTexts([firstUser], [], sessionTitleFallback(SOURCE_LABEL, id)),
      startedAt: timestamp,
      updatedAt: timestamp,
      messages,
      rawEvidence: [],
      metadata: {
        surface: "desktop-cli",
        sourcePath: path,
        timestampSource: "file-mtime",
        fixtureProvenance: FIXTURE_PROVENANCE
      }
    },
    completeMessageRecords,
    mtimeMs,
    fingerprint,
    trailingIncomplete,
    unknownBlockTypes,
    invalid,
    unreadable
  };
}

async function fileEndsWithNewline(path: string, size: number): Promise<boolean> {
  if (size === 0) return true;
  const file = await open(path, "r");
  try {
    const byte = Buffer.alloc(1);
    const result = await file.read(byte, 0, 1, size - 1);
    return result.bytesRead === 1 && byte[0] === 0x0a;
  } finally {
    await file.close();
  }
}

function appendBoundedDiagnostics(diagnostics: Diagnostic[], counters: ImportCounters): void {
  if (counters.duplicates > 0) {
    diagnostics.push(cursorDiagnostic("info", "cursor_duplicates_deduplicated", `${counters.duplicates} duplicate Cursor transcript files were deduplicated by conversation ID.`));
  }
  if (counters.noMessages > 0) {
    diagnostics.push(cursorDiagnostic("info", "cursor_no_messages", `${counters.noMessages} Cursor transcript files had no importable direct user or assistant text.`));
  }
  if (counters.trailingIncomplete > 0) {
    diagnostics.push(cursorDiagnostic("info", "cursor_trailing_incomplete", `${counters.trailingIncomplete} Cursor transcript files ended with an incomplete record; their complete prefixes were imported.`));
  }
  if (counters.unknownSchema > 0) {
    diagnostics.push(cursorDiagnostic("warning", "cursor_schema_unknown", `${counters.unknownSchema} Cursor transcript files contained unknown content block types; known direct text was imported.`));
  }
  if (counters.invalid > 0) {
    diagnostics.push(cursorDiagnostic("error", "cursor_transcript_invalid", `${counters.invalid} Cursor transcript files had malformed interior records or incompatible message fields and were skipped.`));
  }
  if (counters.unreadable > 0) {
    diagnostics.push(cursorDiagnostic("error", "cursor_transcript_unreadable", `${counters.unreadable} Cursor transcript files could not be read and were skipped.`));
  }
}

function setFingerprint(values: Set<string>): Record<string, true> {
  return Object.fromEntries([...values].sort().map((value) => [value, true]));
}

function cursorDiagnostic(severity: "info" | "warning" | "error", code: string, message: string): Diagnostic {
  return diagnostic(SOURCE_ID, severity, code, message);
}
