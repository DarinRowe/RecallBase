import { open, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ImportBatchInput, NormalizedConversationInput, NormalizedMessageInput } from "@recallbase/core";
import type { Diagnostic } from "@recallbase/contracts";
import { diagnostic } from "../common/diagnostics";
import {
  fileSchemaFingerprint,
  findFiles,
  pathExists,
  schemaFingerprint,
  sessionTitleFallback,
  titleFromMessageTexts,
  userHome
} from "../common/discovery";
import type { SourceDiscoveryResult, SourceImporter } from "../common/importer";
import { asArray, asIsoDate, asObject, asString, readJsonObject, streamJsonl } from "../common/json";

const SOURCE_ID = "grok-build";
const SOURCE_LABEL = "Grok Build";
const UPDATES_FILE = "updates.jsonl";
const SUMMARY_FILE = "summary.json";

interface CandidateMessage {
  upstreamId: string;
  role: "user" | "assistant";
  createdAt: string;
  parts: string[];
  promptIndex?: number;
  modelId?: string;
}

export function createGrokBuildImporter(): SourceImporter {
  return {
    id: SOURCE_ID,
    label: SOURCE_LABEL,
    async discover(options = {}) {
      const roots = options.roots ?? [defaultSessionsRoot()];
      const candidates = options.roots
        ? await findFiles(roots, (path) => basename(path) === UPDATES_FILE, 7)
        : await findDefaultUpdatePaths(roots[0]!);
      const updatePaths = [];
      for (const path of candidates) {
        if (await looksLikeGrokSession(path)) updatePaths.push(path);
      }
      const paths = await withSummarySidecars(updatePaths);
      const result: SourceDiscoveryResult = {
        id: SOURCE_ID,
        label: SOURCE_LABEL,
        paths,
        present: updatePaths.length > 0,
        confidence: "stable",
        confidenceReason: "Fixture coverage follows Grok Build's documented summary.json and authoritative ACP updates.jsonl format.",
        diagnostics: []
      };
      if (paths.length > 0) result.schemaFingerprint = await fileSchemaFingerprint(paths);
      return result;
    },
    importBatchesFromPaths(paths, options) {
      return importGrokBuildBatches(paths, options?.discovery);
    }
  };
}

function defaultSessionsRoot(): string {
  const configuredHome = process.env.GROK_HOME?.trim();
  return configuredHome ? join(configuredHome, "sessions") : userHome(".grok", "sessions");
}

async function findDefaultUpdatePaths(sessionsRoot: string): Promise<string[]> {
  const paths: string[] = [];
  for (const workspace of await directoryNames(sessionsRoot)) {
    const workspacePath = join(sessionsRoot, workspace);
    for (const session of await directoryNames(workspacePath)) {
      const updatesPath = join(workspacePath, session, UPDATES_FILE);
      if (await pathExists(updatesPath)) paths.push(updatesPath);
    }
  }
  return paths.sort();
}

async function directoryNames(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function looksLikeGrokSession(updatesPath: string): Promise<boolean> {
  let file;
  try {
    file = await open(updatesPath, "r");
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const sample = buffer.subarray(0, bytesRead).toString("utf8");
    const hasUpdate = /"sessionUpdate"\s*:/.test(sample);
    const hasEnvelope = /"method"\s*:\s*"(?:_x\.ai\/)?session\/update"/.test(sample);
    const hasLegacyNotification = /"sessionId"\s*:/.test(sample) && /"update"\s*:/.test(sample);
    return hasUpdate && (hasEnvelope || hasLegacyNotification);
  } catch {
    return false;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

async function withSummarySidecars(updatePaths: string[]): Promise<string[]> {
  const paths = new Set(updatePaths);
  for (const updatesPath of updatePaths) {
    const summaryPath = join(dirname(updatesPath), SUMMARY_FILE);
    if (await pathExists(summaryPath)) paths.add(summaryPath);
  }
  return [...paths].sort();
}

function sessionDirForPath(path: string): string {
  return dirname(path);
}

async function* importGrokBuildBatches(
  paths: string[],
  discovery?: SourceDiscoveryResult
): AsyncIterable<ImportBatchInput> {
  const sessionDirs = [...new Set(paths.map(sessionDirForPath))].sort();
  let includeDiscoveryDiagnostics = true;
  let sessionsWithoutMessages = 0;

  for (const sessionDir of sessionDirs) {
    const diagnostics: Diagnostic[] = includeDiscoveryDiagnostics ? [...(discovery?.diagnostics ?? [])] : [];
    includeDiscoveryDiagnostics = false;
    const summaryPath = join(sessionDir, SUMMARY_FILE);
    const updatesPath = join(sessionDir, UPDATES_FILE);
    let summary: Record<string, unknown> | undefined;
    try {
      summary = (await readJsonObject(summaryPath)).value;
    } catch (error) {
      diagnostics.push(
        diagnostic(
          SOURCE_ID,
          "warning",
          "grok_build_summary_unreadable",
          `Could not read Grok Build session metadata: ${errorMessage(error)}.`,
          summaryPath
        )
      );
    }

    if (isHiddenSession(summary)) continue;
    const formatVersion = numberValue(summary?.chat_format_version);
    if (formatVersion !== undefined && formatVersion > 1) {
      diagnostics.push(
        diagnostic(
          SOURCE_ID,
          "warning",
          "grok_build_schema_newer",
          `Grok Build chat format ${formatVersion} is newer than the verified format 1; known visible events will be imported.`,
          summaryPath
        )
      );
    }

    try {
      const reducer = new GrokBuildSessionReducer(sessionDir, summary, await workspaceFallback(sessionDir));
      diagnostics.push(...await streamJsonl(
        updatesPath,
        SOURCE_ID,
        (record) => reducer.add(record.value, record.line),
        {
          trailingIncompleteCode: "grok_build_trailing_record_incomplete",
          trailingIncompleteMessage: "An incomplete trailing Grok Build update was skipped."
        }
      ));
      const conversation = reducer.finish();
      if (!conversation) sessionsWithoutMessages += 1;
      yield importBatch(conversation ? [conversation] : [], diagnostics, discovery?.schemaFingerprint ?? reducer.fingerprint());
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "error", "source_unreadable", `Could not read Grok Build source: ${errorMessage(error)}.`, updatesPath)
      );
      yield importBatch([], diagnostics, discovery?.schemaFingerprint);
    }
  }

  if (sessionsWithoutMessages > 0) {
    yield importBatch(
      [],
      [
        diagnostic(
          SOURCE_ID,
          "warning",
          "grok_build_no_messages",
          `${sessionsWithoutMessages} Grok Build sessions had no user-visible messages.`
        )
      ],
      discovery?.schemaFingerprint
    );
  }
}

function importBatch(
  conversations: NormalizedConversationInput[],
  diagnostics: Diagnostic[],
  fingerprint?: string
): ImportBatchInput {
  const batch: ImportBatchInput = {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    conversations,
    diagnostics,
    confidence: "stable",
    confidenceReason: "Fixture coverage follows Grok Build's documented summary.json and authoritative ACP updates.jsonl format."
  };
  if (fingerprint !== undefined) batch.schemaFingerprint = fingerprint;
  return batch;
}

/*
 * Only ACP user and agent message chunks are retained. Tool traffic, thoughts,
 * hooks, plans, and task events become unreachable after each add call.
 */
class GrokBuildSessionReducer {
  private readonly candidates: CandidateMessage[] = [];
  private readonly promptStarts: number[] = [];
  private readonly shapes: unknown[] = [];
  private readonly fallbackTime: string;
  private readonly modelId: string | undefined;
  private open: CandidateMessage | undefined;
  private seenPromptIndex = false;

  constructor(
    private readonly sessionDir: string,
    private readonly summary: Record<string, unknown> | undefined,
    private readonly fallbackWorkspace: string | undefined
  ) {
    this.fallbackTime = optionalGrokTime(summary?.created_at) ?? new Date(0).toISOString();
    this.modelId = asString(summary?.current_model_id);
  }

  add(record: Record<string, unknown>, line: number): void {
    if (this.shapes.length < 20) this.shapes.push(recordShape(record));
    const method = asString(record.method);
    const params = asObject(record.params) ?? (asObject(record.update) ? record : undefined);
    if (!params) {
      this.closeSegment();
      return;
    }
    const rawUpdate = params?.update;
    const updates = Array.isArray(rawUpdate) ? rawUpdate : [rawUpdate];
    updates.forEach((value, index) => this.addUpdate(value, method ?? "session/update", record.timestamp, line, index));
  }

  fingerprint(): string {
    return schemaFingerprint(this.shapes);
  }

  finish(): NormalizedConversationInput | undefined {
    const messages = this.candidates
      .map((candidate) => normalizeCandidate(candidate))
      .filter((message): message is NormalizedMessageInput => message !== undefined);
    if (messages.length === 0) return undefined;

    const info = asObject(this.summary?.info);
    const sessionId = asString(info?.id) ?? basename(this.sessionDir);
    const times = messages.map((message) => message.createdAt).sort();
    const startedAt = optionalGrokTime(this.summary?.created_at) ?? times[0] ?? this.fallbackTime;
    const updatedAt = optionalGrokTime(this.summary?.updated_at) ?? times[times.length - 1] ?? startedAt;
    const generatedTitle = asString(this.summary?.generated_title);
    const sessionSummary = asString(this.summary?.session_summary);

    return {
      sourceId: SOURCE_ID,
      sourceLabel: SOURCE_LABEL,
      upstreamId: sessionId,
      title: titleFromMessageTexts(
        [generatedTitle, sessionSummary, ...messages.filter((message) => message.role === "user").map((message) => message.text)],
        messages.map((message) => message.text),
        sessionTitleFallback(SOURCE_LABEL, sessionId)
      ),
      startedAt,
      updatedAt,
      messages,
      rawEvidence: [],
      metadata: {
        sourcePath: join(this.sessionDir, UPDATES_FILE),
        format: "grok-acp-updates-jsonl",
        workspaceDirectory: asString(info?.cwd) ?? this.fallbackWorkspace,
        currentModelId: this.modelId,
        parentSessionId: asString(this.summary?.parent_session_id),
        sessionKind: asString(this.summary?.session_kind),
        agentName: asString(this.summary?.agent_name),
        chatFormatVersion: numberValue(this.summary?.chat_format_version),
        fixtureProvenance: "tests/fixtures/importers/grok-build"
      }
    };
  }

  private addUpdate(value: unknown, method: string, timestamp: unknown, line: number, index: number): void {
    const update = asObject(value);
    const kind = asString(update?.sessionUpdate);
    if (method === "_x.ai/session/update" && kind === "rewind_marker") {
      this.rewind(indexValue(update?.target_prompt_index));
      return;
    }
    if (method !== "session/update") {
      this.closeSegment();
      return;
    }
    if (kind === "agent_thought_chunk") {
      if (this.open?.role !== "assistant") this.closeSegment();
      return;
    }
    if (kind !== "user_message_chunk" && kind !== "agent_message_chunk") {
      this.closeSegment();
      return;
    }
    const content = asObject(update?.content);
    const contentType = asString(content?.type);
    if (contentType !== "text") {
      this.closeSegment();
      return;
    }
    const contentMeta = asObject(content?._meta);
    const updateMeta = asObject(update?._meta);
    if (kind === "user_message_chunk" && (asString(contentMeta?.bash_command) || updateMeta?.hostTurn === true)) {
      this.closeSegment();
      return;
    }
    const rawText = typeof contentMeta?.displayText === "string" ? contentMeta.displayText : content?.text;
    const text = typeof rawText === "string" && rawText.trim() ? rawText : undefined;
    if (!text) {
      this.closeSegment();
      return;
    }
    const promptIndex = kind === "user_message_chunk" ? indexValue(updateMeta?.promptIndex) : undefined;
    if (promptIndex !== undefined) this.seenPromptIndex = true;
    if (kind === "user_message_chunk" && this.seenPromptIndex && promptIndex === undefined) {
      this.closeSegment();
      return;
    }

    const role = kind === "user_message_chunk" ? "user" : "assistant";
    const continues = this.open?.role === role && (role === "assistant" || this.open.promptIndex === promptIndex);
    if (continues) {
      this.open!.parts.push(text);
      return;
    }

    this.closeSegment();
    const candidate: CandidateMessage = {
      upstreamId: `L${line}-${index + 1}`,
      role,
      createdAt: grokTime(timestamp, this.fallbackTime),
      parts: [text]
    };
    if (promptIndex !== undefined) candidate.promptIndex = promptIndex;
    if (role === "assistant" && this.modelId !== undefined) candidate.modelId = this.modelId;
    if (role === "user") this.promptStarts.push(this.candidates.length);
    this.candidates.push(candidate);
    this.open = candidate;
  }

  private closeSegment(): void {
    this.open = undefined;
  }

  private rewind(target: number | undefined): void {
    this.closeSegment();
    if (target === undefined) return;
    const truncateAt = this.promptStarts[target] ?? this.candidates.length;
    this.candidates.length = truncateAt;
    this.promptStarts.length = Math.min(target, this.promptStarts.length);
    this.seenPromptIndex = this.candidates.some((candidate) => candidate.role === "user" && candidate.promptIndex !== undefined);
  }
}

function normalizeCandidate(candidate: CandidateMessage): NormalizedMessageInput | undefined {
  const text = candidate.parts.join("").trim();
  if (!text) return undefined;
  const message: NormalizedMessageInput = {
    upstreamId: candidate.upstreamId,
    role: candidate.role,
    createdAt: candidate.createdAt,
    text
  };
  if (candidate.modelId !== undefined) message.modelId = candidate.modelId;
  return message;
}

function grokTime(value: unknown, fallback: string): string {
  return optionalGrokTime(value) ?? fallback;
}

function optionalGrokTime(value: unknown): string | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : undefined;
  if (numeric !== undefined && Number.isFinite(numeric)) {
    const milliseconds = Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  const sentinel = "invalid";
  const result = asIsoDate(value, sentinel);
  return result === sentinel ? undefined : result;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function indexValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function isHiddenSession(summary: Record<string, unknown> | undefined): boolean {
  if (summary?.hidden === true) return true;
  if (summary?.hidden === false) return false;
  return asString(summary?.session_kind)?.startsWith("subagent") === true;
}

async function workspaceFallback(sessionDir: string): Promise<string | undefined> {
  try {
    const value = (await readFile(join(dirname(sessionDir), ".cwd"), "utf8")).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function recordShape(record: Record<string, unknown>): unknown {
  const params = asObject(record.params);
  const firstUpdate = asObject(asArray(params?.update)[0] ?? params?.update);
  const content = asObject(firstUpdate?.content);
  return {
    keys: Object.keys(record).sort(),
    paramsKeys: Object.keys(params ?? {}).sort(),
    updateKeys: Object.keys(firstUpdate ?? {}).sort(),
    contentKeys: Object.keys(content ?? {}).sort()
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
