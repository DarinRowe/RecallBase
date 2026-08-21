import { readdir } from "node:fs/promises";
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

const SOURCE_ID = "kimi-code";
const SOURCE_LABEL = "Kimi Code";
const MAIN_WIRE_SUFFIX = join("agents", "main", "wire.jsonl");

interface CandidateMessage {
  upstreamId?: string;
  role: "user" | "assistant";
  createdAt: string;
  parts: string[];
  modelId?: string;
  realUser: boolean;
}

export function createKimiCodeImporter(): SourceImporter {
  return {
    id: SOURCE_ID,
    label: SOURCE_LABEL,
    async discover(options = {}) {
      const roots = options.roots ?? [defaultSessionsRoot()];
      const wirePaths = options.roots
        ? await findFiles(roots, isMainWirePath, 7)
        : await findDefaultWirePaths(roots[0]!);
      const paths = await withStateSidecars(wirePaths);
      const result: SourceDiscoveryResult = {
        id: SOURCE_ID,
        label: SOURCE_LABEL,
        paths,
        present: wirePaths.length > 0,
        confidence: "stable",
        confidenceReason: "Fixture coverage follows Kimi Code's documented state.json and agents/main/wire.jsonl session format.",
        diagnostics: []
      };
      if (paths.length > 0) result.schemaFingerprint = await fileSchemaFingerprint(paths);
      return result;
    },
    importBatchesFromPaths(paths, options) {
      return importKimiCodeBatches(paths, options?.discovery);
    }
  };
}

function defaultSessionsRoot(): string {
  const configuredHome = process.env.KIMI_CODE_HOME?.trim();
  return configuredHome ? join(configuredHome, "sessions") : userHome(".kimi-code", "sessions");
}

async function findDefaultWirePaths(sessionsRoot: string): Promise<string[]> {
  const paths: string[] = [];
  for (const bucket of await directoryNames(sessionsRoot)) {
    const bucketPath = join(sessionsRoot, bucket);
    for (const session of await directoryNames(bucketPath)) {
      const wirePath = join(bucketPath, session, MAIN_WIRE_SUFFIX);
      if (await pathExists(wirePath)) paths.push(wirePath);
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

async function withStateSidecars(wirePaths: string[]): Promise<string[]> {
  const paths = new Set(wirePaths);
  for (const wirePath of wirePaths) {
    const statePath = join(sessionDirForPath(wirePath), "state.json");
    if (await pathExists(statePath)) paths.add(statePath);
  }
  return [...paths].sort();
}

function isMainWirePath(path: string): boolean {
  return path.endsWith(MAIN_WIRE_SUFFIX);
}

function sessionDirForPath(path: string): string {
  if (basename(path) === "state.json") return dirname(path);
  return dirname(dirname(dirname(path)));
}

async function* importKimiCodeBatches(
  paths: string[],
  discovery?: SourceDiscoveryResult
): AsyncIterable<ImportBatchInput> {
  const sessionDirs = [...new Set(paths.map(sessionDirForPath))].sort();
  let includeDiscoveryDiagnostics = true;
  let sessionsWithoutMessages = 0;

  for (const sessionDir of sessionDirs) {
    const diagnostics: Diagnostic[] = includeDiscoveryDiagnostics ? [...(discovery?.diagnostics ?? [])] : [];
    includeDiscoveryDiagnostics = false;
    const statePath = join(sessionDir, "state.json");
    const wirePath = join(sessionDir, MAIN_WIRE_SUFFIX);
    let state: Record<string, unknown> | undefined;
    try {
      if (await pathExists(statePath)) state = (await readJsonObject(statePath)).value;
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "warning", "kimi_code_state_unreadable", `Could not read Kimi Code session metadata: ${errorMessage(error)}.`, statePath)
      );
    }

    try {
      const reducer = new KimiSessionReducer(sessionDir, state);
      diagnostics.push(...await streamJsonl(
        wirePath,
        SOURCE_ID,
        (record) => reducer.add(record.value),
        {
          trailingIncompleteCode: "kimi_code_trailing_record_incomplete",
          trailingIncompleteMessage: "An incomplete trailing Kimi Code record was skipped."
        }
      ));
      const conversation = reducer.finish();
      if (!conversation) sessionsWithoutMessages += 1;
      yield importBatch(conversation ? [conversation] : [], diagnostics, discovery?.schemaFingerprint ?? reducer.fingerprint());
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "error", "source_unreadable", `Could not read Kimi Code source: ${errorMessage(error)}.`, wirePath)
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
          "kimi_code_no_messages",
          `${sessionsWithoutMessages} Kimi Code sessions had no user-visible messages.`
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
    confidenceReason: "Fixture coverage follows Kimi Code's documented state.json and agents/main/wire.jsonl session format."
  };
  if (fingerprint !== undefined) batch.schemaFingerprint = fingerprint;
  return batch;
}

/*
 * Streaming reducer: its interface accepts one wire record and returns one
 * normalized conversation. Raw tool/request records become unreachable after
 * each add call, so memory scales with useful transcript text, not wire size.
 */
class KimiSessionReducer {
  private readonly candidates: CandidateMessage[] = [];
  private readonly pendingPrompts: CandidateMessage[] = [];
  private readonly openSteps = new Map<string, CandidateMessage>();
  private readonly shapes: unknown[] = [];
  private activeStep: CandidateMessage | undefined;
  private undoFloor = 0;
  private readonly fallbackTime: string;

  constructor(
    private readonly sessionDir: string,
    private readonly state: Record<string, unknown> | undefined
  ) {
    this.fallbackTime = isoTime(state?.createdAt ?? state?.updatedAt, new Date(0).toISOString());
  }

  add(record: Record<string, unknown>): void {
    if (this.shapes.length < 20) this.shapes.push(recordShape(record));
    this.addRecord(record);
  }

  fingerprint(): string {
    return schemaFingerprint(this.shapes);
  }

  finish(): NormalizedConversationInput | undefined {
    return normalizeReducedSession(this.sessionDir, this.state, this.fallbackTime, this.candidates);
  }

  private addRecord(record: Record<string, unknown>): void {
    const { candidates, pendingPrompts, openSteps, fallbackTime } = this;
    const type = asString(record.type);
    if (type === "turn.prompt" || type === "turn.steer") {
      const text = userVisibleText(record.input, record.origin);
      if (!text) return;
      const candidate: CandidateMessage = {
        role: "user",
        createdAt: isoTime(record.time, fallbackTime),
        parts: [text],
        realUser: true
      };
      candidates.push(candidate);
      pendingPrompts.push(candidate);
      return;
    }

    if (type === "context.append_message") {
      const message = asObject(record.message);
      const role = asString(message?.role);
      if (role !== "user" && role !== "assistant") return;
      const text = role === "user" ? userVisibleText(message?.content, message?.origin) : visibleText(message?.content);
      if (!text) return;
      if (role === "user") {
        const pendingIndex = pendingPrompts.findIndex((pending) => pending.parts.join("\n") === text);
        if (pendingIndex !== -1) {
          const [pending] = pendingPrompts.splice(pendingIndex, 1);
          if (pending) {
            pending.createdAt = isoTime(record.time, pending.createdAt);
            const messageId = asString(message?.id);
            if (messageId !== undefined) pending.upstreamId = messageId;
          }
          return;
        }
      }
      const candidate: CandidateMessage = {
        role,
        createdAt: isoTime(record.time, fallbackTime),
        parts: [text],
        realUser: role === "user"
      };
      const messageId = asString(message?.id);
      if (messageId !== undefined) candidate.upstreamId = messageId;
      candidates.push(candidate);
      return;
    }

    if (type === "context.append_loop_event") {
      const event = asObject(record.event);
      const eventType = asString(event?.type);
      if (eventType === "step.begin") {
        const stepId = asString(event?.uuid);
        if (!stepId) return;
        const candidate: CandidateMessage = {
          upstreamId: stepId,
          role: "assistant",
          createdAt: isoTime(record.time, fallbackTime),
          parts: [],
          realUser: false
        };
        candidates.push(candidate);
        openSteps.set(stepId, candidate);
        this.activeStep = candidate;
      } else if (eventType === "content.part") {
        const stepId = asString(event?.stepUuid);
        const candidate = stepId ? openSteps.get(stepId) : undefined;
        const text = visibleText(event?.part);
        if (candidate && text) candidate.parts.push(text);
      } else if (eventType === "step.end") {
        const stepId = asString(event?.uuid);
        if (stepId) openSteps.delete(stepId);
        if (this.activeStep?.upstreamId === stepId) this.activeStep = undefined;
      }
      return;
    }

    if (type === "llm.request" && this.activeStep) {
      const modelId = asString(record.modelAlias) ?? asString(record.model);
      if (modelId !== undefined) this.activeStep.modelId = modelId;
      return;
    }

    if (type === "context.undo") {
      applyUndo(candidates, numberValue(record.count), this.undoFloor);
      pendingPrompts.length = 0;
      openSteps.clear();
      this.activeStep = undefined;
      return;
    }

    if (type === "context.clear" || type === "context.apply_compaction") {
      this.undoFloor = candidates.length;
      pendingPrompts.length = 0;
      openSteps.clear();
      this.activeStep = undefined;
    }
  }
}

function normalizeReducedSession(
  sessionDir: string,
  state: Record<string, unknown> | undefined,
  fallbackTime: string,
  candidates: CandidateMessage[]
): NormalizedConversationInput | undefined {
  const messages = dedupeMessages(
    candidates
      .map(normalizeCandidate)
      .filter((message): message is NormalizedMessageInput => message !== undefined)
  );
  if (messages.length === 0) return undefined;

  const sessionId = asString(state?.id) ?? basename(sessionDir);
  const stateStartedAt = optionalIsoTime(state?.createdAt);
  const stateUpdatedAt = optionalIsoTime(state?.updatedAt);
  const times = messages.map((message) => message.createdAt).sort();
  const startedAt = stateStartedAt ?? times[0] ?? fallbackTime;
  const updatedAt = stateUpdatedAt ?? times[times.length - 1] ?? startedAt;
  const stateTitle = asString(state?.title);
  const workspaceDirectory = asString(state?.cwd) ?? asString(state?.workDir);

  return {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    upstreamId: sessionId,
    title: titleFromMessageTexts(
      [stateTitle, ...messages.filter((message) => message.role === "user").map((message) => message.text)],
      messages.map((message) => message.text),
      sessionTitleFallback(SOURCE_LABEL, sessionId)
    ),
    startedAt,
    updatedAt,
    messages,
    rawEvidence: [],
    metadata: {
      sourcePath: join(sessionDir, MAIN_WIRE_SUFFIX),
      format: "wire-jsonl",
      workspaceDirectory,
      archived: state?.archived === true,
      forkedFrom: asString(state?.forkedFrom),
      sessionVersion: typeof state?.version === "number" ? state.version : undefined,
      fixtureProvenance: "tests/fixtures/importers/kimi-code"
    }
  };
}

function normalizeCandidate(candidate: CandidateMessage): NormalizedMessageInput | undefined {
  const text = candidate.parts.map((part) => part.trim()).filter(Boolean).join("\n").trim();
  if (!text) return undefined;
  const message: NormalizedMessageInput = {
    role: candidate.role,
    createdAt: candidate.createdAt,
    text
  };
  if (candidate.upstreamId !== undefined) message.upstreamId = candidate.upstreamId;
  if (candidate.modelId !== undefined) message.modelId = candidate.modelId;
  return message;
}

function visibleText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const text = value
      .map((part) => visibleTextPart(part))
      .filter((part): part is string => Boolean(part))
      .join("\n")
      .trim();
    return text || undefined;
  }
  return visibleTextPart(value);
}

function visibleTextPart(value: unknown): string | undefined {
  const part = asObject(value);
  if (!part) return undefined;
  const type = asString(part.type);
  if (type === "image_url") return "[image]";
  if (type === "audio_url") return "[audio]";
  if (type === "video_url") return "[video]";
  if (type !== undefined && type !== "text") return undefined;
  return asString(part.text);
}

function userVisibleText(content: unknown, originValue: unknown): string | undefined {
  const origin = asObject(originValue);
  if (!origin) {
    const text = visibleText(content);
    return text && !isInternalReminder(text) ? text : undefined;
  }
  const kind = asString(origin.kind);
  if (kind === "skill_activation") {
    if (asString(origin.trigger) !== "user-slash") return undefined;
    return slashCommand(asString(origin.skillName), asString(origin.skillArgs));
  }
  if (kind === "plugin_command") {
    if (asString(origin.trigger) !== "user-slash") return undefined;
    const pluginId = asString(origin.pluginId);
    const commandName = asString(origin.commandName);
    return pluginId && commandName ? slashCommand(`${pluginId}:${commandName}`, asString(origin.commandArgs)) : undefined;
  }
  if (kind !== undefined && kind !== "user") return undefined;

  const parts = asArray(content);
  const bundledSkillCount = kind === "user" ? asArray(origin.skillActivations).length : 0;
  const text = visibleText(parts.length > 0 ? parts.slice(bundledSkillCount) : content);
  return text && !isInternalReminder(text) ? text : undefined;
}

function slashCommand(name: string | undefined, args: string | undefined): string | undefined {
  if (!name) return undefined;
  const command = `/${name}`;
  return args ? `${command} ${args.trim()}`.trim() : command;
}

function isInternalReminder(text: string): boolean {
  return /^<system-reminder>[\s\S]*<\/system-reminder>$/i.test(text.trim());
}

function applyUndo(messages: CandidateMessage[], count: number, floor: number): void {
  if (count <= 0) return;
  let removedUsers = 0;
  while (messages.length > floor && removedUsers < count) {
    const removed = messages.pop();
    if (removed?.realUser) removedUsers += 1;
  }
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isoTime(value: unknown, fallback: string): string {
  return asIsoDate(value, fallback);
}

function optionalIsoTime(value: unknown): string | undefined {
  const sentinel = "invalid";
  const result = asIsoDate(value, sentinel);
  return result === sentinel ? undefined : result;
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

function recordShape(record: Record<string, unknown>): unknown {
  const shape: Record<string, unknown> = { keys: Object.keys(record).sort() };
  const event = asObject(record.event);
  if (event) shape.eventKeys = Object.keys(event).sort();
  const message = asObject(record.message);
  if (message) shape.messageKeys = Object.keys(message).sort();
  const content = asArray(message?.content);
  if (content[0] !== undefined) shape.contentKeys = Object.keys(asObject(content[0]) ?? {}).sort();
  return shape;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
