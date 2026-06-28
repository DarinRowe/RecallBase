import type { ImportBatchInput, NormalizedConversationInput, NormalizedMessageInput } from "@recallbase/core";
import type { Diagnostic } from "@recallbase/contracts";
import { diagnostic } from "../common/diagnostics";
import { fileSchemaFingerprint, fileStem, fileUri, findFiles, schemaFingerprint, titleFromText, userHome } from "../common/discovery";
import type { SourceDiscoveryResult, SourceImporter } from "../common/importer";
import { asArray, asIsoDate, asObject, asString, readJsonl, readJsonObject, textFromContent } from "../common/json";

const SOURCE_ID = "copilot";
const SOURCE_LABEL = "GitHub Copilot";

export function createCopilotImporter(): SourceImporter {
  return {
    id: SOURCE_ID,
    label: SOURCE_LABEL,
    async discover(options = {}) {
      const roots = options.roots ?? [
        userHome("Library", "Application Support", "Code", "User", "workspaceStorage"),
        userHome(".config", "Code", "User", "workspaceStorage")
      ];
      const paths = await findFiles(
        roots,
        (path) => /\.(json|jsonl)$/.test(path) && path.split(/[\\/]/).includes("chatSessions")
      );
      const diagnostics: Diagnostic[] = [];
      if (paths.length > 0) {
        diagnostics.push(
          diagnostic(
            SOURCE_ID,
            "info",
            "copilot_experimental",
            "Copilot importer is experimental because fixture coverage only covers VS Code chatSessions JSON."
          )
        );
      }
      const result: SourceDiscoveryResult = {
        id: SOURCE_ID,
        label: SOURCE_LABEL,
        paths,
        present: paths.length > 0,
        confidence: "experimental",
        confidenceReason: "Fixture coverage covers VS Code chatSessions JSON; Copilot storage shapes vary by extension version.",
        diagnostics
      };
      if (paths.length > 0) result.schemaFingerprint = await fileSchemaFingerprint(paths);
      return result;
    },
    importFromPaths(paths, options) {
      return importCopilotPaths(paths, options?.discovery);
    }
  };
}

async function importCopilotPaths(paths: string[], discovery?: SourceDiscoveryResult): Promise<ImportBatchInput> {
  const conversations: NormalizedConversationInput[] = [];
  const diagnostics: Diagnostic[] = [...(discovery?.diagnostics ?? [])];
  const fingerprints: unknown[] = [];

  for (const path of paths) {
    try {
      const { value } = path.endsWith(".jsonl")
        ? await readJsonlSession(path, diagnostics)
        : await readJsonObject(path);
      fingerprints.push(Object.keys(value).sort());
      const conversation = normalizeCopilotSession(path, value, diagnostics);
      if (conversation) conversations.push(conversation);
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "error", "source_unreadable", `Could not read Copilot chat session: ${errorMessage(error)}.`, path)
      );
    }
  }

  return {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    conversations,
    diagnostics,
    schemaFingerprint: discovery?.schemaFingerprint ?? schemaFingerprint(fingerprints),
    confidence: "experimental",
    confidenceReason: "Fixture coverage covers VS Code chatSessions JSON; Copilot storage shapes vary by extension version."
  };
}

async function readJsonlSession(path: string, diagnostics: Diagnostic[]): Promise<{ value: Record<string, unknown> }> {
  const read = await readJsonl(path, SOURCE_ID);
  diagnostics.push(...read.diagnostics);
  const candidates = read.records
    .map((record) => asObject(record.value.v) ?? record.value)
    .filter((record) => asObject(record)?.sessionId || asArray(asObject(record)?.requests).length > 0)
    .map((record) => asObject(record))
    .filter((record): record is Record<string, unknown> => Boolean(record));
  const value = candidates.sort((left, right) => asArray(right.requests).length - asArray(left.requests).length)[0];
  if (!value) throw new Error("Copilot JSONL did not contain a session snapshot.");
  return { value };
}

function normalizeCopilotSession(
  path: string,
  session: Record<string, unknown>,
  diagnostics: Diagnostic[]
): NormalizedConversationInput | undefined {
  const rawUri = fileUri(path);
  const requests = asArray(session.requests);
  const messages: NormalizedMessageInput[] = [];
  const fallbackTime = asIsoDate(session.creationDate, new Date(0).toISOString());

  requests.forEach((requestValue, index) => {
    const request = asObject(requestValue);
    if (!request) return;
    const requestId = asString(request.requestId) ?? asString(request.id) ?? `request-${index + 1}`;
    const createdAt = asIsoDate(request.timestamp ?? request.creationDate ?? session.creationDate, fallbackTime);
    const userText =
      textFromContent(request.message) ??
      textFromContent(asObject(request.message)?.text) ??
      textFromContent(request.prompt) ??
      textFromContent(request.text);
    if (userText) {
      messages.push({
        upstreamId: `${requestId}:user`,
        role: "user",
        createdAt,
        text: userText
      });
    }

    const responseText = copilotResponseText(request);
    if (responseText) {
      messages.push({
        upstreamId: `${requestId}:assistant`,
        role: "assistant",
        createdAt: asIsoDate(request.responseDate ?? request.lastMessageDate ?? session.lastMessageDate, createdAt),
        text: responseText
      });
    } else {
      diagnostics.push(
        diagnostic(
          SOURCE_ID,
          "warning",
          "copilot_response_unmapped",
          "Copilot request response shape was not recognized; the source path was recorded for diagnostics.",
          rawUri
        )
      );
    }
  });

  if (requests.length === 0) {
    diagnostics.push(
      diagnostic(SOURCE_ID, "warning", "copilot_no_requests", "Copilot session had no requests array.", rawUri)
    );
  }

  const startedAt = messages[0]?.createdAt ?? fallbackTime;
  const updatedAt = asIsoDate(session.lastMessageDate ?? session.updatedAt, messages[messages.length - 1]?.createdAt ?? startedAt);
  const upstreamId = asString(session.sessionId) ?? asString(session.id) ?? fileStem(path);
  const uniqueMessages = dedupeMessages(messages);
  if (uniqueMessages.length === 0) {
    diagnostics.push(
      diagnostic(SOURCE_ID, "warning", "copilot_no_messages", "Copilot session had no importable messages.", rawUri)
    );
    return undefined;
  }
  const firstUser = messages.find((message) => message.role === "user")?.text;

  return {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    upstreamId,
    title: titleFromText(
      asString(session.customTitle) ?? asString(session.name) ?? asString(session.title) ?? firstUser ?? "",
      `Copilot ${upstreamId}`
    ),
    startedAt,
    updatedAt,
    messages: uniqueMessages,
    rawEvidence: [],
    metadata: {
      sourcePath: path,
      workspace: asString(session.workspaceFolder) ?? asString(session.workspace) ?? undefined,
      fixtureProvenance: "tests/fixtures/importers/copilot"
    }
  };
}

function copilotResponseText(request: Record<string, unknown>): string | undefined {
  const direct = textFromContent(request.response) ?? textFromContent(request.result);
  if (direct) return direct;
  const result = asObject(request.result);
  const resultText = textFromContent(result?.message) ?? textFromContent(result?.response);
  if (resultText) return resultText;
  const response = asArray(request.response);
  const chunks = response
    .map((item) => {
      const object = asObject(item);
      return textFromContent(object?.value) ?? textFromContent(object?.text) ?? textFromContent(object?.content);
    })
    .filter((item): item is string => Boolean(item));
  return chunks.join("\n").trim() || undefined;
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
