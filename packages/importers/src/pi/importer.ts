import { open } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ImportBatchInput, NormalizedConversationInput, NormalizedMessageInput } from "@recallbase/core";
import type { Diagnostic } from "@recallbase/contracts";
import { diagnostic } from "../common/diagnostics";
import {
  fileSchemaFingerprint,
  findFiles,
  schemaFingerprint,
  sessionTitleFallback,
  titleFromMessageTexts,
  userHome
} from "../common/discovery";
import type { SourceDiscoveryResult, SourceImporter } from "../common/importer";
import { asArray, asIsoDate, asObject, asString, readJsonObject, streamJsonl } from "../common/json";

const SOURCE_ID = "pi";
const SOURCE_LABEL = "Pi";
const CURRENT_SESSION_VERSION = 3;
const SESSION_SAMPLE_BYTES = 64 * 1024;

interface CandidateMessage {
  upstreamId?: string;
  role: "user" | "assistant";
  createdAt: string;
  text: string;
  modelId?: string;
}

interface TreeEntry {
  id?: string;
  parentId?: string | null;
  candidate?: CandidateMessage;
  modelId?: string;
}

interface DefaultSessionLocations {
  sessionRoot: string;
  agentRoot: string;
}

interface ReducedSession {
  conversation?: NormalizedConversationInput;
  diagnostics: Diagnostic[];
  sourceVersion?: string;
  fingerprint: string;
}

export function createPiImporter(): SourceImporter {
  return {
    id: SOURCE_ID,
    label: SOURCE_LABEL,
    async discover(options = {}) {
      const candidates = options.roots
        ? await findFiles(options.roots, isJsonl, 8)
        : await findDefaultCandidates();
      const paths: string[] = [];
      for (const path of candidates) {
        if (await looksLikePiSession(path)) paths.push(path);
      }
      const result: SourceDiscoveryResult = {
        id: SOURCE_ID,
        label: SOURCE_LABEL,
        paths,
        present: paths.length > 0,
        confidence: "stable",
        confidenceReason: "Fixture coverage follows Pi's documented versioned JSONL session tree format.",
        diagnostics: []
      };
      if (paths.length > 0) result.schemaFingerprint = await fileSchemaFingerprint(paths);
      return result;
    },
    importBatchesFromPaths(paths, options) {
      return importPiBatches(paths, options?.discovery);
    }
  };
}

async function findDefaultCandidates(): Promise<string[]> {
  const locations = await defaultSessionLocations();
  const current = await findFiles([locations.sessionRoot], isJsonl, 3);
  const legacy = await findFiles(
    [locations.agentRoot],
    (path) => dirname(path) === locations.agentRoot && isJsonl(path),
    1
  );
  return [...new Set([...current, ...legacy])].sort();
}

function isJsonl(path: string): boolean {
  return basename(path).endsWith(".jsonl");
}

async function defaultSessionLocations(): Promise<DefaultSessionLocations> {
  const agentRoot = expandConfiguredPath(process.env.PI_CODING_AGENT_DIR?.trim() || userHome(".pi", "agent"));
  const configuredSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  if (configuredSessionDir) return { sessionRoot: expandConfiguredPath(configuredSessionDir), agentRoot };

  try {
    const settings = (await readJsonObject(join(agentRoot, "settings.json"))).value;
    const settingsSessionDir = asString(settings.sessionDir);
    if (settingsSessionDir) return { sessionRoot: expandConfiguredPath(settingsSessionDir), agentRoot };
  } catch {
    // Pi treats missing or unusable optional settings as no sessionDir override.
  }
  return { sessionRoot: join(agentRoot, "sessions"), agentRoot };
}

function expandConfiguredPath(path: string): string {
  if (path === "~") return userHome();
  if (path.startsWith("~/") || path.startsWith("~\\")) return resolve(userHome(), path.slice(2));
  return resolve(path);
}

async function looksLikePiSession(path: string): Promise<boolean> {
  let file;
  try {
    file = await open(path, "r");
    const buffer = Buffer.alloc(SESSION_SAMPLE_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/, 1)[0]?.trim();
    if (!firstLine) return false;
    const header = asObject(JSON.parse(firstLine) as unknown);
    const released = header?.type === "session" && asString(header.id) !== undefined && asString(header.timestamp) !== undefined;
    const v4 = header?.kind === "header" && header.version === 4 && asString(header.id) !== undefined;
    return released || v4;
  } catch {
    return false;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

async function* importPiBatches(
  paths: string[],
  discovery?: SourceDiscoveryResult
): AsyncIterable<ImportBatchInput> {
  let includeDiscoveryDiagnostics = true;
  let sessionsWithoutMessages = 0;

  for (const path of [...new Set(paths)].sort()) {
    const diagnostics: Diagnostic[] = includeDiscoveryDiagnostics ? [...(discovery?.diagnostics ?? [])] : [];
    includeDiscoveryDiagnostics = false;
    try {
      const reducer = new PiSessionReducer(path);
      diagnostics.push(...await streamJsonl(
        path,
        SOURCE_ID,
        (record) => reducer.add(record.value, record.line),
        {
          trailingIncompleteCode: "pi_trailing_record_incomplete",
          trailingIncompleteMessage: "An incomplete trailing Pi session record was skipped."
        }
      ));
      const reduced = reducer.finish();
      diagnostics.push(...reduced.diagnostics);
      if (!reduced.conversation) sessionsWithoutMessages += 1;
      yield importBatch(
        reduced.conversation ? [reduced.conversation] : [],
        diagnostics,
        discovery?.schemaFingerprint ?? reduced.fingerprint,
        reduced.sourceVersion
      );
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "error", "source_unreadable", `Could not read Pi source: ${errorMessage(error)}.`, path)
      );
      yield importBatch([], diagnostics, discovery?.schemaFingerprint);
    }
  }

  if (sessionsWithoutMessages > 0) {
    yield importBatch(
      [],
      [diagnostic(SOURCE_ID, "warning", "pi_no_messages", `${sessionsWithoutMessages} Pi sessions had no user-visible messages.`)],
      discovery?.schemaFingerprint
    );
  }
}

function importBatch(
  conversations: NormalizedConversationInput[],
  diagnostics: Diagnostic[],
  fingerprint?: string,
  sourceVersion?: string
): ImportBatchInput {
  const batch: ImportBatchInput = {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    conversations,
    diagnostics,
    confidence: "stable",
    confidenceReason: "Fixture coverage follows Pi's documented versioned JSONL session tree format."
  };
  if (fingerprint !== undefined) batch.schemaFingerprint = fingerprint;
  if (sourceVersion !== undefined) batch.sourceVersion = sourceVersion;
  return batch;
}

/*
 * Pi persists an append-only tree. Keep only lightweight structural entries
 * plus user-visible text, then resolve the current branch from Pi's leaf cursor.
 * Tool payloads, thinking, summaries, and extension state are discarded as
 * each line is read.
 */
class PiSessionReducer {
  private header: Record<string, unknown> | undefined;
  private readonly entries: TreeEntry[] = [];
  private readonly byId = new Map<string, TreeEntry>();
  private readonly shapes: unknown[] = [];
  private latestName: string | undefined;
  private leafId: string | null | undefined;
  private duplicateIds = 0;
  private invalidTreeEntries = 0;

  constructor(private readonly path: string) {}

  add(record: Record<string, unknown>, line: number): void {
    if (this.shapes.length < 20) this.shapes.push(recordShape(record));
    if (!this.header) {
      if (record.type === "session" || record.kind === "header") this.header = record;
      return;
    }
    if (record.type === "session" || record.kind === "header") return;

    if (record.type === "session_info") {
      this.latestName = asString(record.name);
    }

    const version = sessionVersion(this.header);
    const id = asString(record.id);
    if (version >= 2 && !id) {
      this.invalidTreeEntries += 1;
      return;
    }
    const rawParentId = record.parentId;
    const parentId = rawParentId === null ? null : asString(rawParentId);
    if (version >= 2 && rawParentId !== null && !parentId) this.invalidTreeEntries += 1;

    const entry: TreeEntry = {};
    if (id !== undefined) entry.id = id;
    if (rawParentId === null) entry.parentId = null;
    else if (parentId !== undefined) entry.parentId = parentId;

    if (record.type === "model_change") {
      const modelId = asString(record.modelId);
      if (modelId !== undefined) entry.modelId = modelId;
    } else if (record.type === "message") {
      const candidate = messageCandidate(record, line, this.header);
      if (candidate !== undefined) entry.candidate = candidate;
    }

    this.entries.push(entry);
    if (id) {
      if (this.byId.has(id)) this.duplicateIds += 1;
      this.byId.set(id, entry);
      if (record.type === "leaf") {
        const targetId = record.targetId === null ? null : asString(record.targetId);
        if (record.targetId !== null && targetId === undefined) this.invalidTreeEntries += 1;
        else this.leafId = targetId;
      } else {
        this.leafId = id;
      }
    }
  }

  finish(): ReducedSession {
    const diagnostics: Diagnostic[] = [];
    if (!this.header) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "error", "pi_session_header_invalid", "Pi session did not start with a valid session header.", this.path)
      );
      return { diagnostics, fingerprint: schemaFingerprint(this.shapes) };
    }

    if (this.header.kind === "header") {
      const version = typeof this.header.version === "number" ? String(this.header.version) : undefined;
      diagnostics.push(
        diagnostic(
          SOURCE_ID,
          "error",
          "pi_session_version_unsupported",
          "Pi session version 4 is not supported yet; its lane-based schema is not compatible with the released v1-v3 session tree.",
          this.path
        )
      );
      const reduced: ReducedSession = { diagnostics, fingerprint: schemaFingerprint(this.shapes) };
      if (version !== undefined) reduced.sourceVersion = version;
      return reduced;
    }

    const version = sessionVersion(this.header);
    if (version > CURRENT_SESSION_VERSION) {
      diagnostics.push(
        diagnostic(
          SOURCE_ID,
          "warning",
          "pi_session_schema_newer",
          `Pi session version ${version} is newer than the verified version ${CURRENT_SESSION_VERSION}; known visible messages were imported.`,
          this.path
        )
      );
    }

    const path = version < 2 ? this.entries : this.activePath();
    const treeInvalid = this.invalidTreeEntries > 0 || this.duplicateIds > 0 || (version >= 2 && path === undefined);
    if (treeInvalid) {
      diagnostics.push(
        diagnostic(
          SOURCE_ID,
          "warning",
          "pi_session_tree_invalid",
          `Pi session tree contained ${this.invalidTreeEntries} invalid entries and ${this.duplicateIds} duplicate IDs; the conversation was skipped to avoid importing an ambiguous branch.`,
          this.path
        )
      );
    }

    if (!path || treeInvalid) {
      return {
        diagnostics,
        sourceVersion: String(version),
        fingerprint: schemaFingerprint(this.shapes)
      };
    }

    const messages = path
      .map((entry) => entry.candidate)
      .filter((message): message is CandidateMessage => message !== undefined)
      .map(normalizeMessage);
    if (messages.length === 0) {
      return {
        diagnostics,
        sourceVersion: String(version),
        fingerprint: schemaFingerprint(this.shapes)
      };
    }

    const sessionId = asString(this.header.id) ?? basename(this.path, ".jsonl");
    const headerTime = optionalIsoTime(this.header.timestamp);
    const times = messages.map((message) => message.createdAt).sort();
    const startedAt = headerTime ?? times[0] ?? new Date(0).toISOString();
    const updatedAt = times[times.length - 1] ?? startedAt;
    const currentModelId = [...path].reverse().find((entry) => entry.modelId || entry.candidate?.modelId)?.modelId
      ?? [...messages].reverse().find((message) => message.modelId)?.modelId;
    const activeLeafId = version >= 2 ? path[path.length - 1]?.id : undefined;

    return {
      conversation: {
        sourceId: SOURCE_ID,
        sourceLabel: SOURCE_LABEL,
        upstreamId: sessionId,
        title: titleFromMessageTexts(
          [this.latestName, ...messages.filter((message) => message.role === "user").map((message) => message.text)],
          messages.map((message) => message.text),
          sessionTitleFallback(SOURCE_LABEL, sessionId)
        ),
        startedAt,
        updatedAt,
        messages,
        rawEvidence: [],
        metadata: {
          sourcePath: this.path,
          format: "pi-session-jsonl",
          workspaceDirectory: asString(this.header.cwd),
          parentSession: asString(this.header.parentSession),
          sessionVersion: version,
          activeLeafId,
          currentModelId,
          fixtureProvenance: "tests/fixtures/importers/pi"
        }
      },
      diagnostics,
      sourceVersion: String(version),
      fingerprint: schemaFingerprint(this.shapes)
    };
  }

  private activePath(): TreeEntry[] | undefined {
    if (this.leafId === null) return [];
    const leaf = this.leafId === undefined ? undefined : this.byId.get(this.leafId);
    if (!leaf?.id) return this.entries.length === 0 ? [] : undefined;

    const reversed: TreeEntry[] = [];
    const seen = new Set<string>();
    let current: TreeEntry | undefined = leaf;
    while (current?.id) {
      if (seen.has(current.id)) {
        this.invalidTreeEntries += 1;
        return undefined;
      }
      seen.add(current.id);
      reversed.push(current);
      if (current.parentId === null) break;
      if (!current.parentId) {
        this.invalidTreeEntries += 1;
        return undefined;
      }
      const parent = this.byId.get(current.parentId);
      if (!parent) {
        this.invalidTreeEntries += 1;
        return undefined;
      }
      current = parent;
    }
    return reversed.reverse();
  }
}

function messageCandidate(
  entry: Record<string, unknown>,
  line: number,
  header: Record<string, unknown>
): CandidateMessage | undefined {
  const message = asObject(entry.message);
  const role = asString(message?.role);
  if (role !== "user" && role !== "assistant") return undefined;
  const text = visibleText(message?.content, role === "user");
  if (!text) return undefined;
  const fallbackTime = asIsoDate(entry.timestamp, asIsoDate(header.timestamp, new Date(0).toISOString()));
  const candidate: CandidateMessage = {
    upstreamId: asString(entry.id) ?? `line-${line}`,
    role,
    createdAt: asIsoDate(message?.timestamp, fallbackTime),
    text
  };
  if (role === "assistant") {
    const modelId = asString(message?.model);
    if (modelId !== undefined) candidate.modelId = modelId;
  }
  return candidate;
}

function visibleText(value: unknown, redactFiles: boolean): string | undefined {
  if (typeof value === "string") return visibleString(value, redactFiles);
  const text = asArray(value)
    .map((part) => visiblePart(part, redactFiles))
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .trim();
  return text || undefined;
}

function visiblePart(value: unknown, redactFiles: boolean): string | undefined {
  const part = asObject(value);
  if (!part) return undefined;
  const type = asString(part.type);
  if (type === "image") return "[image]";
  if (type !== "text") return undefined;
  const text = asString(part.text);
  return text === undefined ? undefined : visibleString(text, redactFiles);
}

function visibleString(value: string, redactFiles: boolean): string | undefined {
  const text = redactFiles ? redactFileWrappers(value) : value;
  return text.trim() || undefined;
}

function redactFileWrappers(text: string): string {
  const complete = text.replace(/<file name="[^"]*">[\s\S]*?<\/file>/g, "[file]");
  return complete.replace(/<file name="[\s\S]*$/g, "[file]");
}

function normalizeMessage(candidate: CandidateMessage): NormalizedMessageInput {
  const message: NormalizedMessageInput = {
    role: candidate.role,
    createdAt: candidate.createdAt,
    text: candidate.text
  };
  if (candidate.upstreamId !== undefined) message.upstreamId = candidate.upstreamId;
  if (candidate.modelId !== undefined) message.modelId = candidate.modelId;
  return message;
}

function sessionVersion(header: Record<string, unknown>): number {
  return typeof header.version === "number" && Number.isFinite(header.version) ? header.version : 1;
}

function optionalIsoTime(value: unknown): string | undefined {
  const sentinel = "invalid";
  const result = asIsoDate(value, sentinel);
  return result === sentinel ? undefined : result;
}

function recordShape(record: Record<string, unknown>): unknown {
  const shape: Record<string, unknown> = { keys: Object.keys(record).sort(), type: asString(record.type) };
  const message = asObject(record.message);
  if (message) {
    shape.messageKeys = Object.keys(message).sort();
    shape.role = asString(message.role);
    const content = asArray(message.content);
    if (content[0] !== undefined) shape.contentKeys = Object.keys(asObject(content[0]) ?? {}).sort();
  }
  return shape;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
