import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import {
  conversationUri,
  type BackupResult,
  type ConversationDetail,
  type ConversationRef,
  type Diagnostic,
  type SearchResultItem,
  type SourceStatus
} from "@recallbase/contracts";
import type { ImportBatchInput, NormalizedConversationInput, NormalizedMessageInput, RawEvidenceInput } from "../batch/conversation";
import { makeSnippet, queryTerms, toFtsQuery } from "../search/search";
import { localDateString, localDayRangeUtc } from "../time/local-date";
import { stableId } from "./identity";
import { migrate } from "./migrations";
import { normalizeRawEvidence } from "./raw-evidence";

interface ConversationRow {
  id: string;
  source_id: string;
  source_label: string;
  title: string;
  started_at: string;
  updated_at: string;
  message_count: number;
  raw_evidence_refs_json: string;
}

interface RawEvidenceRow {
  id: string;
  source_id: string;
  uri: string;
  content_hash: string;
  content: string;
  metadata_json: string;
  created_at: string;
}

interface MessageRow {
  id: string;
  role: ConversationDetail["messages"][number]["role"];
  created_at: string;
  updated_at: string | null;
  text: string;
  thinking: string | null;
  model_id: string | null;
  upstream_ids_json: string;
  attachments_json: string;
  citations_json: string;
  media_json: string;
  raw_evidence_id: string | null;
}

type SearchRow = ConversationRow & {
  message_id: string;
  score: number;
  message_text: string;
  message_thinking: string | null;
};

interface SourceStatusRow {
  id: string;
  label: string;
  health: SourceStatus["health"];
  confidence: SourceStatus["confidence"];
  confidence_reason: string;
  last_import_at: string | null;
  conversations: number;
  messages: number;
  raw_evidence: number;
  cursor: string | null;
  schema_fingerprint: string | null;
  source_version: string | null;
}

interface DiagnosticRow {
  id?: string;
  source_id: string | null;
  severity: Diagnostic["severity"];
  code: string;
  message: string;
  evidence_ref: string | null;
}

export interface LocalBackup {
  format: "recallbase.local-backup";
  schemaVersion: 1;
  exportedAt: string;
  sources: SourceStatus[];
  conversations: Array<ConversationDetail & { metadata: Record<string, unknown> }>;
  rawEvidence: RawEvidenceRow[];
  diagnostics: Diagnostic[];
}

export interface ImportBatchResult {
  conversations: number;
  messages: number;
  rawEvidence: number;
  diagnostics: number;
}

export class LocalDatabase {
  readonly db: Database;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    migrate(this.db);
  }

  close(): void {
    this.db.close();
  }

  importBatch(batch: ImportBatchInput): ImportBatchResult {
    const importedAt = new Date().toISOString();
    const fullSourceImport = batch.scope !== "partial";
    const conversations = mergeBatchConversations(batch.conversations);
    const run = this.db.transaction(() => {
      let messageCount = 0;
      let rawCount = 0;

      if (fullSourceImport) {
        this.db.query("DELETE FROM parser_diagnostics WHERE source_id = ?").run(batch.sourceId);
        this.db
          .query(
            `UPDATE messages
             SET raw_evidence_id = NULL
             WHERE conversation_id IN (SELECT id FROM conversations WHERE source_id = ?)`
          )
          .run(batch.sourceId);
        this.db.query("UPDATE conversations SET raw_evidence_refs_json = '[]' WHERE source_id = ?").run(batch.sourceId);
        this.db.query("DELETE FROM raw_evidence WHERE source_id = ?").run(batch.sourceId);
      }

      const canonicalConversations = conversations.map((conversation) => ({
        conversation,
        id: this.resolveConversationId(conversation)
      }));
      if (fullSourceImport && !hasErrorDiagnostics(batch)) {
        this.deleteSourceConversationsExcept(batch.sourceId, canonicalConversations.map((item) => item.id));
      }

      for (const item of canonicalConversations) {
        const conversationId = item.id;
        const conversation = fullSourceImport
          ? item.conversation
          : this.mergeWithExistingConversation(item.conversation, conversationId);
        this.deleteDuplicateConversations(conversation, conversationId);
        const rawIds = new Map<string, string>();

        for (const raw of conversation.rawEvidence) {
          const record = normalizeRawEvidence(raw);
          rawIds.set(raw.uri, record.id);
          this.db
            .query(
              `INSERT OR IGNORE INTO raw_evidence
               (id, source_id, uri, content_hash, content, metadata_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              record.id,
              record.sourceId,
              record.uri,
              record.contentHash,
              record.content,
              JSON.stringify(record.metadata ?? {}),
              importedAt
            );
          const changes = this.db.query("SELECT changes() AS count").get() as { count: number } | undefined;
          rawCount += changes?.count ?? 0;
        }

        this.db
          .query(
            `INSERT INTO conversations
             (id, source_id, source_label, upstream_id, title, started_at, updated_at, message_count, raw_evidence_refs_json, metadata_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               source_label = excluded.source_label,
               title = excluded.title,
               started_at = excluded.started_at,
               updated_at = excluded.updated_at,
               message_count = excluded.message_count,
               raw_evidence_refs_json = excluded.raw_evidence_refs_json,
               metadata_json = excluded.metadata_json,
               upstream_id = excluded.upstream_id`
          )
          .run(
            conversationId,
            conversation.sourceId,
            conversation.sourceLabel,
            conversation.upstreamId ?? null,
            conversation.title,
            conversation.startedAt,
            conversation.updatedAt,
            conversation.messages.length,
            JSON.stringify([...new Set(rawIds.values())]),
            JSON.stringify(conversation.metadata ?? {})
          );

        this.db.query("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
        this.db.query("DELETE FROM conversation_fts WHERE conversation_id = ?").run(conversationId);

        conversation.messages.forEach((message, index) => {
          const messageId = stableId("msg", [
            conversationId,
            conversation.sourceId,
            conversation.upstreamId ?? conversation.title,
            message.upstreamId ?? String(index),
            message.createdAt,
            message.text,
            message.thinking ?? ""
          ]);
          const rawEvidenceId = message.rawEvidenceUri ? rawIds.get(message.rawEvidenceUri) : undefined;
          this.db
            .query(
              `INSERT INTO messages
               (id, conversation_id, upstream_id, upstream_ids_json, role, created_at, updated_at, text, thinking, model_id, attachments_json, citations_json, media_json, raw_evidence_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              messageId,
              conversationId,
              message.upstreamId ?? null,
              JSON.stringify(message.upstreamIds ?? []),
              message.role,
              message.createdAt,
              message.updatedAt ?? null,
              message.text,
              message.thinking ?? null,
              message.modelId ?? null,
              JSON.stringify(message.attachments ?? []),
              JSON.stringify(message.citations ?? []),
              JSON.stringify(message.media ?? []),
              rawEvidenceId ?? null
            );
          this.db
            .query(
              "INSERT INTO conversation_fts (conversation_id, message_id, title, content) VALUES (?, ?, ?, ?)"
            )
            .run(conversationId, messageId, conversation.title, messageSearchText(message));
          messageCount += 1;
        });

        for (const diagnostic of conversation.diagnostics ?? []) {
          this.insertDiagnostic(diagnostic, importedAt);
        }
      }

      for (const diagnostic of batch.diagnostics ?? []) {
        this.insertDiagnostic(diagnostic, importedAt);
      }

      const sourceTotals = this.sourceTotals(batch.sourceId);
      const existingSource = fullSourceImport ? undefined : this.sources().find((source) => source.id === batch.sourceId);
      const health = batch.diagnostics?.some((diagnostic) => diagnostic.severity === "error")
        ? "partial"
        : existingSource?.health ?? "healthy";
      this.db
        .query(
          `INSERT INTO source_status
           (id, label, health, confidence, confidence_reason, last_import_at, conversations, messages, raw_evidence, cursor, schema_fingerprint, source_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             label = excluded.label,
             health = excluded.health,
             confidence = excluded.confidence,
             confidence_reason = excluded.confidence_reason,
             last_import_at = excluded.last_import_at,
             conversations = excluded.conversations,
             messages = excluded.messages,
             raw_evidence = excluded.raw_evidence,
             cursor = excluded.cursor,
             schema_fingerprint = excluded.schema_fingerprint,
             source_version = excluded.source_version`
        )
        .run(
          batch.sourceId,
          batch.sourceLabel,
          health,
          batch.confidence,
          batch.confidenceReason,
          importedAt,
          sourceTotals.conversations,
          sourceTotals.messages,
          sourceTotals.rawEvidence,
          batch.cursor ?? null,
          batch.schemaFingerprint ?? null,
          batch.sourceVersion ?? null
        );

      return {
        conversations: conversations.length,
        messages: messageCount,
        rawEvidence: rawCount,
        diagnostics: (batch.diagnostics?.length ?? 0) + conversations.reduce((sum, item) => sum + (item.diagnostics?.length ?? 0), 0)
      };
    });

    return run();
  }

  markSourceAbsent(source: Pick<SourceStatus, "id" | "label" | "confidence" | "confidenceReason">): void {
    this.db
      .query(
        `INSERT INTO source_status
         (id, label, health, confidence, confidence_reason, conversations, messages, raw_evidence)
         VALUES (?, ?, 'absent', ?, ?, 0, 0, 0)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           health = excluded.health,
           confidence = excluded.confidence,
           confidence_reason = excluded.confidence_reason`
      )
      .run(source.id, source.label, source.confidence, source.confidenceReason);
  }

  sources(sourceId?: string): SourceStatus[] {
    const rows = sourceId
      ? (this.db.query("SELECT * FROM source_status WHERE id = ? ORDER BY id").all(sourceId) as SourceStatusRow[])
      : (this.db.query("SELECT * FROM source_status ORDER BY id").all() as SourceStatusRow[]);
    return rows.map((row) => {
      const status: SourceStatus = {
        id: row.id,
        label: row.label,
        health: row.health,
        confidence: row.confidence,
        confidenceReason: row.confidence_reason,
        conversations: row.conversations,
        messages: row.messages,
        rawEvidence: row.raw_evidence,
        diagnostics: this.diagnostics(row.id, 50)
      };
      if (row.last_import_at != null) status.lastImportAt = row.last_import_at;
      if (row.cursor != null) status.cursor = row.cursor;
      if (row.schema_fingerprint != null) status.schemaFingerprint = row.schema_fingerprint;
      if (row.source_version != null) status.sourceVersion = row.source_version;
      return status;
    });
  }

  search(query: string, options: { sourceId?: string; date?: string; limit?: number } = {}): SearchResultItem[] {
    const limit = options.limit ?? 10;
    const ftsQuery = toFtsQuery(query);
    const unique = new Map<string, SearchResultItem>();
    if (ftsQuery) this.appendFtsResults(unique, ftsQuery, query, options, limit);
    if (unique.size < limit) this.appendSubstringResults(unique, query, options, limit);

    return [...unique.values()];
  }

  private appendFtsResults(
    unique: Map<string, SearchResultItem>,
    ftsQuery: string,
    query: string,
    options: { sourceId?: string; date?: string },
    limit: number
  ): void {
    const sourceFilter = options.sourceId ? "AND c.source_id = $sourceId" : "";
    const dateFilter = options.date ? "AND c.updated_at >= $dateStart AND c.updated_at < $dateEnd" : "";
    const bindings = this.searchBindings(options, limit);
    if (!bindings) return;
    bindings.$query = ftsQuery;
    const rows = this.db
      .query(
        `SELECT c.*, f.message_id, bm25(conversation_fts) AS score, m.text AS message_text, m.thinking AS message_thinking
         FROM conversation_fts f
         JOIN conversations c ON c.id = f.conversation_id
         JOIN messages m ON m.id = f.message_id
         WHERE conversation_fts MATCH $query
         ${sourceFilter}
         ${dateFilter}
         ORDER BY score ASC, c.updated_at DESC
         LIMIT $limit`
      )
      .all(bindings) as SearchRow[];
    appendSearchRows(unique, rows, query, limit);
  }

  private appendSubstringResults(
    unique: Map<string, SearchResultItem>,
    query: string,
    options: { sourceId?: string; date?: string },
    limit: number
  ): void {
    const terms = queryTerms(query);
    if (terms.length === 0) return;
    const sourceFilter = options.sourceId ? "AND c.source_id = $sourceId" : "";
    const dateFilter = options.date ? "AND c.updated_at >= $dateStart AND c.updated_at < $dateEnd" : "";
    const termFilter = terms
      .map(
        (_, index) =>
          `(instr(lower(c.title), lower($term${index})) > 0 OR instr(lower(m.text), lower($term${index})) > 0 OR instr(lower(COALESCE(m.thinking, '')), lower($term${index})) > 0)`
      )
      .join(" AND ");
    const bindings = this.searchBindings(options, limit);
    if (!bindings) return;
    bindings.$limit = limit;
    terms.forEach((term, index) => {
      bindings[`$term${index}`] = term;
    });
    const rows = this.db
      .query(
        `SELECT * FROM (
           SELECT c.*, m.id AS message_id, 0 AS score, m.text AS message_text, m.thinking AS message_thinking,
                  ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY m.created_at DESC, m.id) AS match_rank
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE ${termFilter}
           ${sourceFilter}
           ${dateFilter}
         )
         WHERE match_rank = 1
         ORDER BY updated_at DESC
         LIMIT $limit`
      )
      .all(bindings) as SearchRow[];
    appendSearchRows(unique, rows, query, limit);
  }

  private searchBindings(
    options: { sourceId?: string; date?: string },
    limit: number
  ): Record<string, string | number> | undefined {
    const bindings: Record<string, string | number> = { $limit: limit * 5 };
    if (options.sourceId) bindings.$sourceId = options.sourceId;
    if (options.date) {
      try {
        const range = localDayRangeUtc(options.date);
        bindings.$dateStart = range.start;
        bindings.$dateEnd = range.end;
      } catch {
        return undefined;
      }
    }
    return bindings;
  }

  today(date = localDateString(), limit = 8): ConversationRef[] {
    let range;
    try {
      range = localDayRangeUtc(date);
    } catch {
      return [];
    }
    const rows = this.db
      .query(
        `SELECT * FROM (
           SELECT * FROM conversations
           WHERE updated_at >= ? AND updated_at < ?
           UNION
           SELECT * FROM conversations
           WHERE started_at >= ? AND started_at < ?
         )
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(range.start, range.end, range.start, range.end, limit) as ConversationRow[];

    return rows.map((row) => toConversationRef(row));
  }

  open(idPrefix: string): ConversationDetail | undefined | "ambiguous" {
    const rows = this.db
      .query("SELECT * FROM conversations WHERE id = ? OR id LIKE ? ORDER BY updated_at DESC")
      .all(idPrefix, `${idPrefix}%`) as ConversationRow[];
    if (rows.length > 1) return "ambiguous";
    const row = rows[0];
    if (!row) return undefined;

    const messages = this.db
      .query("SELECT id, role, created_at, updated_at, text, thinking, model_id, upstream_ids_json, attachments_json, citations_json, media_json, raw_evidence_id FROM messages WHERE conversation_id = ? ORDER BY created_at, id")
      .all(row.id) as MessageRow[];

    return {
      ...toConversationRef(row),
      messages: messages.map((message) => {
        const detail: ConversationDetail["messages"][number] = {
          id: message.id,
          role: message.role,
          createdAt: message.created_at,
          text: message.text
        };
        if (message.updated_at != null && message.updated_at.length > 0) detail.updatedAt = message.updated_at;
        if (message.thinking != null && message.thinking.length > 0) detail.thinking = message.thinking;
        if (message.model_id != null && message.model_id.length > 0) detail.modelId = message.model_id;
        const upstreamIds = parseJsonStringArray(message.upstream_ids_json);
        const attachments = parseJsonArray(message.attachments_json);
        const citations = parseJsonArray(message.citations_json);
        const media = parseJsonArray(message.media_json);
        if (upstreamIds.length > 0) detail.upstreamIds = upstreamIds;
        if (attachments.length > 0) detail.attachments = attachments as NonNullable<ConversationDetail["messages"][number]["attachments"]>;
        if (citations.length > 0) detail.citations = citations as NonNullable<ConversationDetail["messages"][number]["citations"]>;
        if (media.length > 0) detail.media = media as NonNullable<ConversationDetail["messages"][number]["media"]>;
        if (message.raw_evidence_id != null) detail.rawEvidenceId = message.raw_evidence_id;
        return detail;
      }),
      rawEvidenceRefs: JSON.parse(row.raw_evidence_refs_json) as string[],
      diagnostics: this.diagnostics(row.source_id)
    };
  }

  createBackup(exportedAt = new Date().toISOString()): LocalBackup {
    const conversationRows = this.db.query("SELECT * FROM conversations ORDER BY updated_at DESC").all() as Array<
      ConversationRow & { metadata_json: string }
    >;
    const conversations = conversationRows.map((row) => {
      const detail = this.open(row.id);
      if (!detail || detail === "ambiguous") throw new Error(`Could not open conversation ${row.id} for backup.`);
      return {
        ...detail,
        metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
      };
    });
    const rawEvidence = this.db.query("SELECT * FROM raw_evidence ORDER BY created_at, id").all() as RawEvidenceRow[];

    return {
      format: "recallbase.local-backup",
      schemaVersion: 1,
      exportedAt,
      sources: this.sources(),
      conversations,
      rawEvidence,
      diagnostics: this.diagnostics()
    };
  }

  async writeBackup(path: string, exportedAt = new Date().toISOString()): Promise<BackupResult> {
    const checksum = createHash("sha256");
    const stream = createWriteStream(path, { encoding: "utf8" });
    let streamError: Error | undefined;
    const streamErrorPromise = new Promise<never>((_, reject) => {
      stream.once("error", (error) => {
        streamError = error instanceof Error ? error : new Error(String(error));
        reject(streamError);
      });
    });
    streamErrorPromise.catch(() => undefined);
    const throwIfStreamErrored = () => {
      if (streamError) throw streamError;
    };
    const write = async (chunk: string) => {
      throwIfStreamErrored();
      checksum.update(chunk);
      if (!stream.write(chunk)) await Promise.race([once(stream, "drain"), streamErrorPromise]);
      throwIfStreamErrored();
    };

    await write("{\n");
    await write(`  "format": "recallbase.local-backup",\n`);
    await write(`  "schemaVersion": 1,\n`);
    await write(`  "exportedAt": ${JSON.stringify(exportedAt)},\n`);
    await write(`  "sources": ${JSON.stringify(this.sources(), null, 2)},\n`);
    await write(`  "conversations": [\n`);
    let first = true;
    for (const row of this.db.query("SELECT * FROM conversations ORDER BY updated_at DESC").iterate() as Iterable<
      ConversationRow & { metadata_json: string }
    >) {
      const detail = this.open(row.id);
      if (!detail || detail === "ambiguous") throw new Error(`Could not open conversation ${row.id} for backup.`);
      const item = {
        ...detail,
        metadata: JSON.parse(row.metadata_json) as Record<string, unknown>
      };
      await write(`${first ? "" : ",\n"}${indent(JSON.stringify(item, null, 2), 4)}`);
      first = false;
    }
    await write("\n  ],\n");
    await this.writeBackupArray(write, "rawEvidence", "SELECT * FROM raw_evidence ORDER BY created_at, id", (row) => row);
    await write(",\n");
    await this.writeBackupArray(write, "diagnostics", "SELECT * FROM parser_diagnostics ORDER BY created_at DESC", (row) =>
      this.diagnosticFromRow(row as DiagnosticRow)
    );
    await write("\n");
    await write("}\n");

    await Promise.race([
      new Promise<void>((resolve) => stream.end(resolve)),
      streamErrorPromise
    ]);
    throwIfStreamErrored();

    return this.backupResultFromCounts(path, exportedAt, checksum.digest("hex"));
  }

  async writeSqliteBackup(path: string, exportedAt = new Date().toISOString()): Promise<BackupResult> {
    this.db.query("VACUUM INTO ?").run(path);
    return this.backupResultFromCounts(path, exportedAt, await hashFile(path));
  }

  backupResult(path: string, backup: LocalBackup, checksumSha256: string): BackupResult {
    return {
      path,
      exportedAt: backup.exportedAt,
      checksumSha256,
      counts: {
        sources: backup.sources.length,
        conversations: backup.conversations.length,
        messages: backup.conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0),
        rawEvidence: backup.rawEvidence.length,
        diagnostics: backup.diagnostics.length
      }
    };
  }

  private backupResultFromCounts(path: string, exportedAt: string, checksumSha256: string): BackupResult {
    const count = (table: string) => (this.db.query(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
    return {
      path,
      exportedAt,
      checksumSha256,
      counts: {
        sources: count("source_status"),
        conversations: count("conversations"),
        messages: count("messages"),
        rawEvidence: count("raw_evidence"),
        diagnostics: count("parser_diagnostics")
      }
    };
  }

  private sourceTotals(sourceId: string): { conversations: number; messages: number; rawEvidence: number } {
    const conversations = this.db
      .query("SELECT COUNT(*) AS count, COALESCE(SUM(message_count), 0) AS messages FROM conversations WHERE source_id = ?")
      .get(sourceId) as { count: number; messages: number };
    const rawEvidence = this.db.query("SELECT COUNT(*) AS count FROM raw_evidence WHERE source_id = ?").get(sourceId) as { count: number };
    return {
      conversations: conversations.count,
      messages: conversations.messages,
      rawEvidence: rawEvidence.count
    };
  }

  private insertDiagnostic(diagnostic: Diagnostic, createdAt: string): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO parser_diagnostics
         (id, source_id, severity, code, message, evidence_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stableId("diag", [
          diagnostic.sourceId,
          diagnostic.severity,
          diagnostic.code,
          diagnostic.message,
          diagnostic.evidenceRef
        ]),
        diagnostic.sourceId ?? null,
        diagnostic.severity,
        diagnostic.code,
        diagnostic.message,
        diagnostic.evidenceRef ?? null,
        createdAt
      );
  }

  private resolveConversationId(conversation: NormalizedConversationInput): string {
    const existingId = this.findExistingConversationId(conversation);
    return existingId ?? conversationIdFor(conversation);
  }

  private findExistingConversationId(conversation: NormalizedConversationInput): string | undefined {
    const exactId = this.findExactConversationId(conversation);
    if (exactId) return exactId;

    const aliases = upstreamIdentityAliases(conversation).filter((alias) => alias !== conversation.upstreamId);
    if (aliases.length > 0) {
      const placeholders = aliases.map(() => "?").join(", ");
      const row = this.db
        .query(
          `SELECT id FROM conversations
           WHERE source_id = ? AND upstream_id IN (${placeholders})
           ORDER BY updated_at DESC, id DESC
           LIMIT 1`
        )
        .get(conversation.sourceId, ...aliases) as { id: string } | undefined;
      if (row) return row.id;
    }

    return undefined;
  }

  private findExactConversationId(conversation: NormalizedConversationInput): string | undefined {
    const captureSignature = metadataString(conversation.metadata, "captureSignature");
    if (captureSignature) {
      const row = this.db
        .query(
          `SELECT id FROM conversations
           WHERE source_id = ? AND json_extract(metadata_json, '$.captureSignature') = ?
           ORDER BY updated_at DESC, id DESC
           LIMIT 1`
        )
        .get(conversation.sourceId, captureSignature) as { id: string } | undefined;
      if (row) return row.id;
    }

    if (conversation.upstreamId) {
      const row = this.db
        .query(
          `SELECT id FROM conversations
           WHERE source_id = ? AND upstream_id = ?
           ORDER BY updated_at DESC, id DESC
           LIMIT 1`
        )
        .get(conversation.sourceId, conversation.upstreamId) as { id: string } | undefined;
      if (row) return row.id;
    }

    return undefined;
  }

  private deleteDuplicateConversations(conversation: NormalizedConversationInput, canonicalId: string): void {
    const duplicateIds = this.findDuplicateConversationIds(conversation, canonicalId);
    if (duplicateIds.length === 0) return;

    const placeholders = duplicateIds.map(() => "?").join(", ");
    this.db.query(`DELETE FROM conversation_fts WHERE conversation_id IN (${placeholders})`).run(...duplicateIds);
    this.db.query(`DELETE FROM messages WHERE conversation_id IN (${placeholders})`).run(...duplicateIds);
    this.db.query(`DELETE FROM conversations WHERE id IN (${placeholders})`).run(...duplicateIds);
  }

  private deleteSourceConversationsExcept(sourceId: string, keepIds: string[]): void {
    const rows = this.db.query("SELECT id FROM conversations WHERE source_id = ?").all(sourceId) as Array<{ id: string }>;
    const keep = new Set(keepIds);
    const deleteIds = rows.map((row) => row.id).filter((id) => !keep.has(id));
    if (deleteIds.length === 0) return;

    const placeholders = deleteIds.map(() => "?").join(", ");
    this.db.query(`DELETE FROM conversation_fts WHERE conversation_id IN (${placeholders})`).run(...deleteIds);
    this.db.query(`DELETE FROM messages WHERE conversation_id IN (${placeholders})`).run(...deleteIds);
    this.db.query(`DELETE FROM conversations WHERE id IN (${placeholders})`).run(...deleteIds);
  }

  private mergeWithExistingConversation(conversation: NormalizedConversationInput, conversationId: string): NormalizedConversationInput {
    if (!this.findExactConversationId(conversation)) return conversation;
    const existingIds = [conversationId, ...this.findExactDuplicateConversationIds(conversation, conversationId)];
    const placeholders = existingIds.map(() => "?").join(", ");
    const rows = this.db
      .query(`SELECT started_at, updated_at FROM conversations WHERE id IN (${placeholders})`)
      .all(...existingIds) as Array<{ started_at: string; updated_at: string }>;
    if (rows.length === 0) return conversation;

    const existingMessages = this.db
      .query(`SELECT upstream_id, upstream_ids_json, role, created_at, updated_at, text, thinking, model_id, attachments_json, citations_json, media_json FROM messages WHERE conversation_id IN (${placeholders}) ORDER BY created_at, id`)
      .all(...existingIds) as Array<{
        upstream_id: string | null;
        upstream_ids_json: string;
        role: NormalizedMessageInput["role"];
        created_at: string;
        updated_at: string | null;
        text: string;
        thinking: string | null;
        model_id: string | null;
        attachments_json: string;
        citations_json: string;
        media_json: string;
      }>;
    const startedAt = rows.reduce((earliest, row) => earlierIso(earliest, row.started_at), conversation.startedAt);
    const updatedAt = rows.reduce((latest, row) => laterIso(latest, row.updated_at), conversation.updatedAt);

    return {
      ...conversation,
      startedAt,
      updatedAt,
      messages: mergeMessages(
        existingMessages.map((message) => {
          const input: NormalizedMessageInput = {
            role: message.role,
            createdAt: message.created_at,
            text: message.text
          };
          if (message.updated_at != null && message.updated_at.length > 0) input.updatedAt = message.updated_at;
          if (message.thinking != null && message.thinking.length > 0) input.thinking = message.thinking;
          if (message.model_id != null && message.model_id.length > 0) input.modelId = message.model_id;
          const upstreamIds = parseJsonStringArray(message.upstream_ids_json);
          const attachments = parseJsonArray(message.attachments_json);
          const citations = parseJsonArray(message.citations_json);
          const media = parseJsonArray(message.media_json);
          if (upstreamIds.length > 0) input.upstreamIds = upstreamIds;
          if (attachments.length > 0) input.attachments = attachments as NonNullable<NormalizedMessageInput["attachments"]>;
          if (citations.length > 0) input.citations = citations as NonNullable<NormalizedMessageInput["citations"]>;
          if (media.length > 0) input.media = media as NonNullable<NormalizedMessageInput["media"]>;
          if (message.upstream_id != null) input.upstreamId = message.upstream_id;
          return input;
        }),
        conversation.messages
      )
    };
  }

  private findExactDuplicateConversationIds(conversation: NormalizedConversationInput, canonicalId: string): string[] {
    const ids = new Set<string>();
    const captureSignature = metadataString(conversation.metadata, "captureSignature");
    if (captureSignature) {
      for (const row of this.db
        .query(
          `SELECT id FROM conversations
           WHERE source_id = ? AND json_extract(metadata_json, '$.captureSignature') = ? AND id != ?`
        )
        .all(conversation.sourceId, captureSignature, canonicalId) as Array<{ id: string }>) {
        ids.add(row.id);
      }
    }

    if (conversation.upstreamId) {
      for (const row of this.db
        .query(
          `SELECT id FROM conversations
           WHERE source_id = ? AND upstream_id = ? AND id != ?`
        )
        .all(conversation.sourceId, conversation.upstreamId, canonicalId) as Array<{ id: string }>) {
        ids.add(row.id);
      }
    }

    return [...ids];
  }

  private findDuplicateConversationIds(conversation: NormalizedConversationInput, canonicalId: string): string[] {
    const ids = new Set<string>();
    const captureSignature = metadataString(conversation.metadata, "captureSignature");
    if (captureSignature) {
      for (const row of this.db
        .query(
          `SELECT id FROM conversations
           WHERE source_id = ? AND json_extract(metadata_json, '$.captureSignature') = ? AND id != ?`
        )
        .all(conversation.sourceId, captureSignature, canonicalId) as Array<{ id: string }>) {
        ids.add(row.id);
      }
    }

    const aliases = upstreamIdentityAliases(conversation);
    if (aliases.length > 0) {
      const placeholders = aliases.map(() => "?").join(", ");
      for (const row of this.db
        .query(
          `SELECT id FROM conversations
           WHERE source_id = ? AND upstream_id IN (${placeholders}) AND id != ?`
        )
        .all(conversation.sourceId, ...aliases, canonicalId) as Array<{ id: string }>) {
        ids.add(row.id);
      }
    }

    return [...ids];
  }

  private async writeBackupArray<T>(
    write: (chunk: string) => Promise<void>,
    key: string,
    query: string,
    mapRow: (row: T) => unknown
  ): Promise<void> {
    await write(`  "${key}": [\n`);
    let first = true;
    for (const row of this.db.query(query).iterate() as Iterable<T>) {
      await write(`${first ? "" : ",\n"}${indent(JSON.stringify(mapRow(row), null, 2), 4)}`);
      first = false;
    }
    await write("\n  ]");
  }

  private diagnostics(sourceId?: string, limit?: number): Diagnostic[] {
    const limitClause = limit === undefined ? "" : " LIMIT ?";
    const rows = sourceId
      ? (this.db
          .query(`SELECT * FROM parser_diagnostics WHERE source_id = ? ORDER BY created_at DESC${limitClause}`)
          .all(...(limit === undefined ? [sourceId] : [sourceId, limit])) as DiagnosticRow[])
      : (this.db
          .query(`SELECT * FROM parser_diagnostics ORDER BY created_at DESC${limitClause}`)
          .all(...(limit === undefined ? [] : [limit])) as DiagnosticRow[]);
    return rows.map((row) => this.diagnosticFromRow(row));
  }

  private diagnosticFromRow(row: DiagnosticRow): Diagnostic {
    const diagnostic: Diagnostic = {
      severity: row.severity,
      code: row.code,
      message: row.message
    };
    if (row.source_id != null) diagnostic.sourceId = row.source_id;
    if (row.evidence_ref != null) diagnostic.evidenceRef = row.evidence_ref;
    return diagnostic;
  }
}

export function conversationIdFor(conversation: NormalizedConversationInput): string {
  const captureSignature = metadataString(conversation.metadata, "captureSignature");
  if (captureSignature) {
    return stableId("conv", [conversation.sourceId, "captureSignature", captureSignature]);
  }

  if (conversation.upstreamId) {
    return stableId("conv", [conversation.sourceId, "upstreamId", conversation.upstreamId]);
  }

  return stableId("conv", [
    conversation.sourceId,
    conversation.title,
    conversation.startedAt,
    conversation.messages.map((message) => message.upstreamId ?? `${message.text}\u001f${message.thinking ?? ""}`).join("\u001e")
  ]);
}

function mergeBatchConversations(conversations: NormalizedConversationInput[]): NormalizedConversationInput[] {
  const merged = new Map<string, NormalizedConversationInput>();
  for (const conversation of conversations) {
    const key = batchConversationKey(conversation);
    const existing = merged.get(key);
    if (!existing) {
      const copy: NormalizedConversationInput = {
        ...conversation,
        messages: [...conversation.messages],
        rawEvidence: [...conversation.rawEvidence]
      };
      if (conversation.diagnostics) copy.diagnostics = [...conversation.diagnostics];
      if (conversation.metadata) copy.metadata = { ...conversation.metadata };
      merged.set(key, copy);
      continue;
    }

    existing.startedAt = earlierIso(existing.startedAt, conversation.startedAt);
    existing.updatedAt = laterIso(existing.updatedAt, conversation.updatedAt);
    existing.messages = mergeMessages(existing.messages, conversation.messages);
    existing.rawEvidence = mergeRawEvidence(existing.rawEvidence, conversation.rawEvidence);
    const diagnostics = mergeDiagnostics(existing.diagnostics, conversation.diagnostics);
    if (diagnostics) existing.diagnostics = diagnostics;
    else delete existing.diagnostics;
    const metadata = mergeMetadata(existing.metadata, conversation.metadata);
    if (metadata) existing.metadata = metadata;
    else delete existing.metadata;
  }
  return [...merged.values()];
}

function batchConversationKey(conversation: NormalizedConversationInput): string {
  const captureSignature = metadataString(conversation.metadata, "captureSignature");
  if (captureSignature) return `${conversation.sourceId}\u001fmetadata:captureSignature\u001f${captureSignature}`;
  if (conversation.upstreamId) return `${conversation.sourceId}\u001fupstreamId\u001f${conversation.upstreamId}`;
  return `${conversation.sourceId}\u001fid\u001f${conversationIdFor(conversation)}`;
}

function mergeMessages(left: NormalizedMessageInput[], right: NormalizedMessageInput[]): NormalizedMessageInput[] {
  const indexesByKey = new Map<string, number>();
  const result: NormalizedMessageInput[] = [];
  for (const message of [...left, ...right]) {
    const key = messageMergeKey(message);
    const existingIndex = indexesByKey.get(key);
    if (existingIndex !== undefined) {
      result[existingIndex] = mergeMessageMetadata(result[existingIndex]!, message);
      continue;
    }
    indexesByKey.set(key, result.length);
    result.push(message);
  }
  return result;
}

function messageMergeKey(message: NormalizedMessageInput): string {
  return message.upstreamId
    ? `${message.upstreamId}\u001f${message.role}\u001f${message.text}\u001f${message.thinking ?? ""}`
    : `${message.role}\u001f${message.createdAt}\u001f${message.text}\u001f${message.thinking ?? ""}`;
}

function mergeMessageMetadata(left: NormalizedMessageInput, right: NormalizedMessageInput): NormalizedMessageInput {
  const merged: NormalizedMessageInput = { ...left };
  if (right.updatedAt) merged.updatedAt = left.updatedAt ? laterIso(left.updatedAt, right.updatedAt) : right.updatedAt;
  if (right.modelId) merged.modelId = right.modelId;
  const upstreamIds = mergeMetadataArrays(left.upstreamIds, right.upstreamIds);
  if (upstreamIds.length > 0) merged.upstreamIds = upstreamIds as NonNullable<NormalizedMessageInput["upstreamIds"]>;
  const attachments = mergeMetadataArrays(left.attachments, right.attachments);
  const citations = mergeMetadataArrays(left.citations, right.citations);
  const media = mergeMetadataArrays(left.media, right.media);
  if (attachments.length > 0) merged.attachments = attachments as NonNullable<NormalizedMessageInput["attachments"]>;
  if (citations.length > 0) merged.citations = citations as NonNullable<NormalizedMessageInput["citations"]>;
  if (media.length > 0) merged.media = media as NonNullable<NormalizedMessageInput["media"]>;
  return merged;
}

function mergeMetadataArrays<T>(left: T[] | undefined, right: T[] | undefined): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of [...(left ?? []), ...(right ?? [])]) {
    const key = JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function messageSearchText(message: Pick<NormalizedMessageInput, "text" | "thinking">): string {
  return [message.text, message.thinking].filter(Boolean).join("\n");
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonStringArray(value: string): string[] {
  return parseJsonArray(value).filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function messageSnippet(text: string, thinking: string | null, query: string): string {
  const terms = searchTerms(query);
  const thinkingText = thinking ?? "";
  const textHasFirstTerm = terms[0] ? includesNormalized(text, terms[0]) : false;
  const thinkingHasFirstTerm = terms[0] ? includesNormalized(thinkingText, terms[0]) : false;
  if (thinkingText && thinkingHasFirstTerm && !textHasFirstTerm) return `[thinking] ${makeSnippet(thinkingText, query)}`;
  return makeSnippet(text || thinkingText, query);
}

function appendSearchRows(
  unique: Map<string, SearchResultItem>,
  rows: SearchRow[],
  query: string,
  limit: number
): void {
  for (const row of rows) {
    if (unique.has(row.id)) continue;
    unique.set(row.id, {
      ...toConversationRef(row, messageSnippet(row.message_text, row.message_thinking, query)),
      score: row.score,
      matchedMessageId: row.message_id,
      uri: conversationUri(row.id)
    });
    if (unique.size >= limit) break;
  }
}

function searchTerms(query: string): string[] {
  return queryTerms(query).map((term) => term.toLocaleLowerCase());
}

function includesNormalized(text: string, term: string): boolean {
  return text.toLowerCase().includes(term);
}

function mergeRawEvidence(left: RawEvidenceInput[], right: RawEvidenceInput[]): RawEvidenceInput[] {
  const seen = new Set<string>();
  const result: RawEvidenceInput[] = [];
  for (const raw of [...left, ...right]) {
    const key = `${raw.uri}\u001f${raw.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(raw);
  }
  return result;
}

function mergeDiagnostics(left: Diagnostic[] | undefined, right: Diagnostic[] | undefined): Diagnostic[] | undefined {
  const merged = [...(left ?? []), ...(right ?? [])];
  return merged.length > 0 ? merged : undefined;
}

function mergeMetadata(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!left) return right ? { ...right } : undefined;
  if (!right) return left;
  return { ...right, ...left };
}

function hasErrorDiagnostics(batch: ImportBatchInput): boolean {
  return (
    batch.diagnostics?.some((diagnostic) => diagnostic.severity === "error") ||
    batch.conversations.some((conversation) => conversation.diagnostics?.some((diagnostic) => diagnostic.severity === "error"))
  ) ?? false;
}

function earlierIso(left: string, right: string): string {
  return right < left ? right : left;
}

function laterIso(left: string, right: string): string {
  return right > left ? right : left;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function upstreamIdentityAliases(conversation: NormalizedConversationInput): string[] {
  if (!conversation.sourceId.startsWith("browser-extension-")) {
    return conversation.upstreamId ? [conversation.upstreamId] : [];
  }

  const site = conversation.sourceId.slice("browser-extension-".length);
  if (!hasBrowserPathIdentityAliases(site)) {
    return conversation.upstreamId ? [conversation.upstreamId] : [];
  }
  const url = metadataString(conversation.metadata, "url");
  const aliases = new Set<string>();
  const canonicalId = canonicalBrowserConversationId(site, url, conversation.upstreamId);
  if (canonicalId) aliases.add(canonicalId);
  if (conversation.upstreamId) aliases.add(conversation.upstreamId);
  const pathId = pathIdFromUrl(url);
  if (pathId) aliases.add(pathId);
  if (url) aliases.add(url);
  return [...aliases];
}

function hasBrowserPathIdentityAliases(site: string): boolean {
  return site === "perplexity" ||
    site === "deepseek" ||
    site === "grok" ||
    site === "microsoft-copilot" ||
    site === "yuanbao" ||
    site === "gemini" ||
    site === "notebooklm" ||
    site === "google-ai-studio" ||
    site === "github-copilot";
}

function canonicalBrowserConversationId(site: string, url: string | undefined, upstreamId: string | undefined): string | undefined {
  if (site === "perplexity") return perplexityThreadId(upstreamId) ?? matchPath(url, /\/search\/([^/?#]+)/);
  if (site === "deepseek") return matchPath(url, /\/a\/chat\/s\/([^/?#]+)/);
  if (site === "grok") return matchPath(url, /\/(?:chat|c)\/([^/?#]+)/);
  if (site === "microsoft-copilot") return matchPath(url, /\/(?:chats?|threads?)\/([^/?#]+)/);
  if (site === "yuanbao") return matchPath(url, /\/chat\/[^/?#]+\/([^/?#]+)/);
  if (site === "gemini") return lastPathPart(url);
  if (site === "notebooklm") return matchPath(url, /\/notebook\/([^/?#]+)/);
  if (site === "google-ai-studio") return matchPath(url, /\/(?:app\/)?(?:u\/\d+\/)?prompts\/([^/?#]+)/);
  if (site === "github-copilot") return matchPath(url, /\/copilot\/c\/([^/?#]+)/);
  return upstreamId;
}

function perplexityThreadId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const searchPrefix = /^search_(.+)$/.exec(value);
  if (searchPrefix?.[1]) return searchPrefix[1];
  const nestedSearchPrefix = /_search_(.+)$/.exec(value);
  if (nestedSearchPrefix?.[1]) return nestedSearchPrefix[1];
  return value;
}

function matchPath(value: string | undefined, pattern: RegExp): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const match = pattern.exec(url.pathname);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function lastPathPart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.pathname.split("/").filter(Boolean).at(-1);
  } catch {
    return undefined;
  }
}

function pathIdFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    return path.length > 0 ? path.replace(/\//g, "_") : undefined;
  } catch {
    return undefined;
  }
}

function toConversationRef(row: ConversationRow, snippet?: string): ConversationRef {
  const ref: ConversationRef = {
    id: row.id,
    sourceId: row.source_id,
    sourceLabel: row.source_label,
    title: row.title,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count
  };
  if (snippet !== undefined) ref.snippet = snippet;
  return ref;
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

async function hashFile(path: string): Promise<string> {
  const checksum = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", (chunk) => checksum.update(chunk));
  await new Promise<void>((resolve, reject) => {
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  return checksum.digest("hex");
}
