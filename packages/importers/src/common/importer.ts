import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { Database } from "bun:sqlite";
import type { Diagnostic, ImportResult, ImportSourceResult, SourceConfidence, SourceStatus } from "@recallbase/contracts";
import type { ImportBatchInput } from "@recallbase/core";
import type { LocalDatabase } from "@recallbase/core";
import { summarizeDiagnostics } from "./diagnostics";

export interface SourceDiscoveryOptions {
  roots?: string[];
}

export interface SourceDiscoveryResult {
  id: string;
  label: string;
  paths: string[];
  present: boolean;
  confidence: SourceConfidence;
  confidenceReason: string;
  diagnostics: Diagnostic[];
  schemaFingerprint?: string;
  sourceVersion?: string;
  fixtureProvenance?: string;
}

export interface SourceImportOptions {
  discovery?: SourceDiscoveryResult;
}

export interface SourceImporter {
  id: string;
  label: string;
  discover(options?: SourceDiscoveryOptions): Promise<SourceDiscoveryResult>;
  importFromPaths?(paths: string[], options?: SourceImportOptions): Promise<ImportBatchInput>;
  importBatchesFromPaths?(paths: string[], options?: SourceImportOptions): AsyncIterable<ImportBatchInput>;
}

export interface ImportKnownSourcesOptions {
  roots?: string[];
  sourceIds?: string[];
  onProgress?: (message: string) => void;
  skipUnchanged?: boolean;
}

export async function importWithRegistry(
  db: LocalDatabase,
  importers: SourceImporter[],
  options: ImportKnownSourcesOptions = {}
): Promise<ImportResult> {
  const selected = options.sourceIds && options.sourceIds.length > 0
    ? importers.filter((importer) => options.sourceIds?.includes(importer.id))
    : importers;
  const sources: ImportSourceResult[] = [];
  const totals = { conversations: 0, messages: 0, rawEvidence: 0, diagnostics: 0 };

  for (const importer of selected) {
    options.onProgress?.(`Discovering ${importer.label}`);
    const discovery = await importer.discover(options.roots && options.roots.length > 0 ? { roots: options.roots } : undefined);

    if (!discovery.present) {
      db.markSourceAbsent({
        id: importer.id,
        label: importer.label,
        confidence: discovery.confidence,
        confidenceReason: discovery.confidenceReason
      });
      sources.push({
        source: sourceStatusFor(db, importer.id),
        changedConversations: 0,
        changedMessages: 0,
        skippedRecords: 0
      });
      continue;
    }

    const lastImportAt = options.skipUnchanged ? sourceLastImportAt(db, importer.id) : undefined;
    const pathState = options.skipUnchanged ? await sourcePathState(discovery.paths, lastImportAt) : undefined;
    ensureSourceStateTable(db.db);
    const signature = pathState?.signature;
    const previousSignature = pathState === undefined ? undefined : getSourceState(db.db, importSignatureKey(importer.id));
    if (signature !== undefined && previousSignature === signature) {
      sources.push({
        source: sourceStatusFor(db, importer.id),
        changedConversations: 0,
        changedMessages: 0,
        skippedRecords: 0
      });
      continue;
    }
    let pathsToImport = discovery.paths;
    if (signature !== undefined && previousSignature !== undefined && lastImportAt !== undefined) {
      pathsToImport = pathState!.changedPaths;
      if (pathsToImport.length === 0) {
        setSourceState(db.db, importSignatureKey(importer.id), signature);
        sources.push({
          source: sourceStatusFor(db, importer.id),
          changedConversations: 0,
          changedMessages: 0,
          skippedRecords: 0
        });
        continue;
      }
    }

    options.onProgress?.(`Importing ${importer.label}`);
    const importedAllPaths = pathsToImport.length === discovery.paths.length;
    const importOptions = { discovery: { ...discovery, paths: pathsToImport } };
    let batchIndex = 0;
    let changedConversations = 0;
    let changedMessages = 0;
    const batches = importer.importBatchesFromPaths
      ? importer.importBatchesFromPaths(pathsToImport, importOptions)
      : singleBatch(importer, pathsToImport, importOptions);

    for await (const batch of batches) {
      if (!importedAllPaths || batchIndex > 0) batch.scope = "partial";
      const result = db.importBatch(withSummarizedDiagnostics(batch));
      totals.conversations += result.conversations;
      totals.messages += result.messages;
      totals.rawEvidence += result.rawEvidence;
      totals.diagnostics += result.diagnostics;
      changedConversations += result.conversations;
      changedMessages += result.messages;
      batchIndex += 1;
    }
    if (batchIndex === 0) {
      const emptyBatch: ImportBatchInput = {
        sourceId: importer.id,
        sourceLabel: importer.label,
        conversations: [],
        confidence: discovery.confidence,
        confidenceReason: discovery.confidenceReason
      };
      if (discovery.diagnostics !== undefined) emptyBatch.diagnostics = discovery.diagnostics;
      if (discovery.schemaFingerprint !== undefined) emptyBatch.schemaFingerprint = discovery.schemaFingerprint;
      if (discovery.sourceVersion !== undefined) emptyBatch.sourceVersion = discovery.sourceVersion;
      const result = db.importBatch(withSummarizedDiagnostics(emptyBatch));
      totals.diagnostics += result.diagnostics;
    }
    if (signature !== undefined) setSourceState(db.db, importSignatureKey(importer.id), signature);
    sources.push({
      source: sourceStatusFor(db, importer.id),
      changedConversations,
      changedMessages,
      skippedRecords: 0
    });
  }

  return { sources, totals };
}

function withSummarizedDiagnostics(batch: ImportBatchInput): ImportBatchInput {
  const result: ImportBatchInput = { ...batch };
  const diagnostics = summarizeDiagnostics(batch.diagnostics);
  if (diagnostics !== undefined) result.diagnostics = diagnostics;
  else delete result.diagnostics;
  return result;
}

async function* singleBatch(
  importer: SourceImporter,
  paths: string[],
  options: SourceImportOptions
): AsyncIterable<ImportBatchInput> {
  if (!importer.importFromPaths) throw new Error(`Importer ${importer.id} does not implement importFromPaths.`);
  yield await importer.importFromPaths(paths, options);
}

function sourceStatusFor(db: LocalDatabase, sourceId: string): SourceStatus {
  const source = db.sources().find((item) => item.id === sourceId);
  if (!source) throw new Error(`Source status was not recorded for ${sourceId}.`);
  return source;
}

function sourceLastImportAt(db: LocalDatabase, sourceId: string): string | undefined {
  return db.sources().find((item) => item.id === sourceId)?.lastImportAt;
}

function importSignatureKey(sourceId: string): string {
  return `import:${sourceId}:content_signature`;
}

async function sourcePathState(paths: string[], changedAfter?: string): Promise<{ signature: string; changedPaths: string[] }> {
  const threshold = changedAfter === undefined ? undefined : Date.parse(changedAfter);
  const entries = await pathEntries(paths);
  const hash = createHash("sha256");
  const changed: string[] = [];
  for (const entry of entries) {
    hash.update(entry.path);
    hash.update("\0");
    hash.update(entry.exists ? String(entry.size) : "missing");
    hash.update("\0");
    hash.update(entry.exists ? String(entry.mtimeMs) : "");
    hash.update("\0");
    hash.update(entry.exists ? String(entry.ctimeMs) : "");
    hash.update("\n");
    if (threshold === undefined || !Number.isFinite(threshold) || !entry.exists || entry.mtimeMs > threshold) {
      changed.push(entry.path);
    }
  }
  return { signature: hash.digest("hex").slice(0, 32), changedPaths: changed };
}

async function pathEntries(paths: string[]): Promise<Array<{ path: string; exists: true; size: number; mtimeMs: number; ctimeMs: number } | { path: string; exists: false }>> {
  const entries: Array<{ path: string; exists: true; size: number; mtimeMs: number; ctimeMs: number } | { path: string; exists: false }> = [];
  const chunkSize = 64;
  for (let index = 0; index < paths.length; index += chunkSize) {
    const chunk = paths.slice(index, index + chunkSize);
    entries.push(
      ...(await Promise.all(
        chunk.map(async (path) => {
          try {
            const info = await stat(path);
            return { path, exists: true as const, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs };
          } catch {
            return { path, exists: false as const };
          }
        })
      ))
    );
  }
  return entries;
}

function ensureSourceStateTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS source_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

function getSourceState(db: Database, key: string): string | undefined {
  return (db.query("SELECT value FROM source_state WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

function setSourceState(db: Database, key: string, value: string): void {
  db.run(
    `INSERT INTO source_state (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, new Date().toISOString()]
  );
}
