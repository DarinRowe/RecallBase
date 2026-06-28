import { $ } from "bun";
import { Database } from "bun:sqlite";
import type { ImportBatchInput, MessageRole, NormalizedConversationInput, NormalizedMessageInput } from "@recallbase/core";
import type { Diagnostic } from "@recallbase/contracts";
import { diagnostic } from "../common/diagnostics";
import { fileSchemaFingerprint, fileUri, findFiles, schemaFingerprint, titleFromText, userHome } from "../common/discovery";
import type { SourceDiscoveryResult, SourceImporter } from "../common/importer";
import { asIsoDate, asString } from "../common/json";

const SOURCE_ID = "opencode";
const SOURCE_LABEL = "opencode";

type Row = Record<string, unknown>;

export function createOpencodeImporter(): SourceImporter {
  return {
    id: SOURCE_ID,
    label: SOURCE_LABEL,
    async discover(options = {}) {
      const roots = options.roots ?? [await opencodeDbPath(), userHome(".local", "share", "opencode"), userHome(".opencode")].filter(
        (item): item is string => Boolean(item)
      );
      const paths = await findFiles(roots, (path) => /\.(db|sqlite|sqlite3)$/.test(path), 4);
      const diagnostics: Diagnostic[] = [];
      if (paths.length > 0) {
        diagnostics.push(
          diagnostic(
            SOURCE_ID,
            "info",
            "opencode_experimental",
            "opencode importer is experimental because fixture coverage only covers the observed SQLite session/message/part tables."
          )
        );
      }
      const result: SourceDiscoveryResult = {
        id: SOURCE_ID,
        label: SOURCE_LABEL,
        paths,
        present: paths.length > 0,
        confidence: "experimental",
        confidenceReason: "Fixture coverage covers observed opencode SQLite session, message, part, workspace, and project tables.",
        diagnostics
      };
      if (paths.length > 0) result.schemaFingerprint = await fileSchemaFingerprint(paths);
      return result;
    },
    importFromPaths(paths, options) {
      return importOpencodePaths(paths, options?.discovery);
    }
  };
}

async function opencodeDbPath(): Promise<string | undefined> {
  try {
    const output = await $`opencode db path`.quiet().text();
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function importOpencodePaths(paths: string[], discovery?: SourceDiscoveryResult): Promise<ImportBatchInput> {
  const conversations: NormalizedConversationInput[] = [];
  const diagnostics: Diagnostic[] = [...(discovery?.diagnostics ?? [])];
  const fingerprints: unknown[] = [];

  for (const path of paths) {
    try {
      const db = new Database(path, { readonly: true });
      try {
        const schema = inspectSchema(db);
        fingerprints.push(schema);
        conversations.push(...normalizeDatabase(path, db, schema, diagnostics));
      } finally {
        db.close();
      }
    } catch (error) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "error", "opencode_database_unreadable", `Could not read opencode database: ${errorMessage(error)}.`, path)
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
    confidenceReason: "Fixture coverage covers observed opencode SQLite session, message, part, workspace, and project tables."
  };
}

function inspectSchema(db: Database): Record<string, string[]> {
  const tableRows = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  const schema: Record<string, string[]> = {};
  for (const row of tableRows) {
    schema[row.name] = (db.query(`PRAGMA table_info(${quoteIdent(row.name)})`).all() as Array<{ name: string }>).map(
      (column) => column.name
    );
  }
  return schema;
}

function normalizeDatabase(path: string, db: Database, schema: Record<string, string[]>, diagnostics: Diagnostic[]): NormalizedConversationInput[] {
  if (!schema.session || !schema.message) {
    diagnostics.push(
      diagnostic(
        SOURCE_ID,
        "error",
        "opencode_schema_unsupported",
        "opencode database is missing required session or message tables.",
        path
      )
    );
    return [];
  }

  const sessions = db.query(`SELECT * FROM ${quoteIdent("session")}`).all() as Row[];
  const messages = db.query(`SELECT * FROM ${quoteIdent("message")}`).all() as Row[];
  const parts = schema.part ? (db.query(`SELECT * FROM ${quoteIdent("part")}`).all() as Row[]) : [];
  const workspaces = schema.workspace ? (db.query(`SELECT * FROM ${quoteIdent("workspace")}`).all() as Row[]) : [];
  const projects = schema.project ? (db.query(`SELECT * FROM ${quoteIdent("project")}`).all() as Row[]) : [];
  const messagesBySession = groupRows(messages, ["session_id", "sessionID", "session"]);
  const partsByMessage = groupRows(parts, ["message_id", "messageID", "message"]);

  return sessions.map((session): NormalizedConversationInput | undefined => {
    const sessionId = idValue(session) ?? "unknown-session";
    const rawUri = fileUri(path, `#session=${encodeURIComponent(sessionId)}`);
    const sessionMessages = messagesBySession.get(sessionId) ?? [];
    const normalizedMessages = sessionMessages
      .map((message, index) => normalizeMessage(message, partsByMessage.get(idValue(message) ?? "") ?? [], index))
      .filter((message): message is NormalizedMessageInput => message !== undefined);
    if (normalizedMessages.length === 0) {
      diagnostics.push(
        diagnostic(SOURCE_ID, "warning", "opencode_no_messages", "opencode session had no importable messages.", rawUri)
      );
      return undefined;
    }
    const startedAt = normalizedMessages[0]?.createdAt ?? timeValue(session, "created_at", "createdAt", "time", "created") ?? new Date(0).toISOString();
    const updatedAt =
      timeValue(session, "updated_at", "updatedAt", "lastMessageDate", "time", "created") ??
      normalizedMessages[normalizedMessages.length - 1]?.createdAt ??
      startedAt;
    const workspace = findLinkedRow(session, workspaces, ["workspace_id", "workspaceID", "workspace"]);
    const project = findLinkedRow(session, projects, ["project_id", "projectID", "project"]);
    const title = asString(session.title) ?? asString(session.name) ?? normalizedMessages.find((message) => message.role === "user")?.text ?? "";

    return {
      sourceId: SOURCE_ID,
      sourceLabel: SOURCE_LABEL,
      upstreamId: sessionId,
      title: titleFromText(title, `opencode ${sessionId}`),
      startedAt,
      updatedAt,
      messages: dedupeMessages(normalizedMessages),
      rawEvidence: [],
      metadata: {
        sourcePath: path,
        workspaceDirectory: asString(workspace?.directory) ?? asString(workspace?.path),
        projectDirectory: asString(project?.directory) ?? asString(project?.path),
        fixtureProvenance: "tests/fixtures/importers/opencode"
      }
    };
  }).filter((item): item is NormalizedConversationInput => item !== undefined);
}

function normalizeMessage(message: Row, parts: Row[], index: number): NormalizedMessageInput | undefined {
  const text =
    asString(message.content) ??
    asString(message.text) ??
    parts
      .map((part) => asString(part.text) ?? asString(part.content))
      .filter((item): item is string => Boolean(item))
      .join("\n")
      .trim();
  if (!text) return undefined;
  return {
    upstreamId: idValue(message) ?? `message-${index + 1}`,
    role: normalizeRole(asString(message.role) ?? asString(message.type)),
    createdAt: timeValue(message, "created_at", "createdAt", "time", "timestamp") ?? new Date(0).toISOString(),
    text
  };
}

function groupRows(rows: Row[], candidateColumns: string[]): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = firstString(row, candidateColumns);
    if (!key) continue;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return grouped;
}

function findLinkedRow(source: Row, rows: Row[], candidateColumns: string[]): Row | undefined {
  const key = firstString(source, candidateColumns);
  return key ? rows.find((row) => idValue(row) === key) : undefined;
}

function idValue(row: Row): string | undefined {
  return firstString(row, ["id", "uuid", "session_id", "sessionID"]);
}

function firstString(row: Row, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asString(row[key]);
    if (value) return value;
  }
  return undefined;
}

function timeValue(row: Row, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined) return asIsoDate(value, new Date(0).toISOString());
  }
  return undefined;
}

function normalizeRole(value: string | undefined): MessageRole {
  if (value === "user" || value === "assistant" || value === "system" || value === "tool") return value;
  return "unknown";
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

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
