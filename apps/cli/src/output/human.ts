import type {
  ConversationDetail,
  ImportResult,
  BackupResult,
  ResultEnvelope,
  SearchResult,
  SourcesResult,
  SyncResult,
  SyncStatusResult,
  TodayResult,
  DeviceKeyResult,
  ExtensionHostInstallResult
} from "@recallbase/contracts";

export function formatHuman(result: ResultEnvelope<unknown>): string {
  if (!result.ok) {
    return `Error: ${result.error.message}${result.error.hint ? `\nHint: ${result.error.hint}` : ""}\n`;
  }

  switch (result.meta.command) {
    case "today":
      return formatToday(result.data as TodayResult);
    case "search":
      return formatSearch(result.data as SearchResult);
    case "open":
      return formatOpen(result.data as ConversationDetail);
    case "sources":
      return formatSources(result.data as SourcesResult);
    case "import":
      return formatImport(result.data as ImportResult);
    case "backup":
      return formatBackup(result.data as BackupResult);
    case "sync":
      return formatSync(result.data as SyncResult);
    case "sync-status":
      return formatSyncStatus(result.data as SyncStatusResult);
    case "extension-install-host":
    case "extension-verify-host":
      return formatExtensionHost(result.data as ExtensionHostInstallResult);
    case "login":
      return "Login flow started. Follow the browser prompt or copyable URL.\n";
    case "key":
      return formatKey(result.data as DeviceKeyResult);
    default:
      return `${JSON.stringify(result.data, null, 2)}\n`;
  }
}

function formatBackup(data: BackupResult): string {
  return `Backup written to ${data.path}\n${data.counts.conversations} conversations, ${data.counts.messages} messages, ${data.counts.rawEvidence} raw evidence records\nsha256: ${data.checksumSha256}\n`;
}

function formatToday(data: TodayResult): string {
  const lines = [`${data.date}: ${data.summary}`];
  for (const session of data.keySessions) {
    lines.push(`- ${session.title} [${session.sourceLabel}] ${session.id}`);
    if (session.snippet) lines.push(`  ${session.snippet}`);
  }
  if (data.continuationHints.length > 0) {
    lines.push("Continue:");
    for (const hint of data.continuationHints) lines.push(`- ${hint}`);
  }
  appendSourceWarnings(lines, data.sourceCoverage);
  return `${lines.join("\n")}\n`;
}

function formatSearch(data: SearchResult): string {
  const lines = [`${data.results.length} result${data.results.length === 1 ? "" : "s"} for "${data.query}"`];
  for (const result of data.results) {
    lines.push(`- ${result.title} [${result.sourceLabel}] ${result.id}`);
    if (result.snippet) lines.push(`  ${result.snippet}`);
  }
  if (data.results.length === 0) lines.push("Try a broader query or run rb sources to check imported sources.");
  appendSourceWarnings(lines, data.sourceCoverage);
  return `${lines.join("\n")}\n`;
}

function formatOpen(data: ConversationDetail): string {
  const lines = [`${data.title} [${data.sourceLabel}]`, `id: ${data.id}`, `updated: ${data.updatedAt}`];
  for (const message of data.messages) {
    lines.push(`\n${message.role} ${message.createdAt}`);
    if (message.thinking) lines.push(`[thinking]\n${message.thinking}`);
    lines.push(message.text);
  }
  if (data.rawEvidenceRefs.length > 0) lines.push(`\nraw evidence: ${data.rawEvidenceRefs.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

function formatSources(data: SourcesResult): string {
  if (data.sources.length === 0) return "No sources have been imported yet. Run rb import.\n";
  const lines = data.sources.map(
    (source) =>
      `${source.id}: ${source.health}, ${source.conversations} conversations, ${source.messages} messages, confidence ${source.confidence} (${source.confidenceReason})`
  );
  for (const source of data.sources) {
    for (const diagnostic of source.diagnostics) {
      lines.push(`  ${source.id} ${diagnostic.severity}: ${diagnostic.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatImport(data: ImportResult): string {
  const lines = [
    `Imported ${data.totals.conversations} conversations, ${data.totals.messages} messages, ${data.totals.rawEvidence} raw evidence records.`
  ];
  for (const source of data.sources) {
    lines.push(
      `- ${source.source.id}: ${source.changedConversations} conversations, ${source.changedMessages} messages, ${source.source.health}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function formatSync(data: SyncResult): string {
  return `Synced ${data.uploadedSearchDocuments} search documents, ${data.uploadedEncryptedConversationChunks} encrypted conversation chunks, and ${data.uploadedEncryptedRawBlobs} encrypted raw blobs. Mode: ${data.mode}.\n`;
}

function formatKey(data: DeviceKeyResult): string {
  return `Device key ${data.id} (${data.algorithm} v${data.version}) created ${data.createdAt}${data.path ? `\npath: ${data.path}` : ""}\n`;
}

function formatSyncStatus(data: SyncStatusResult): string {
  if (!data.loggedIn) return "Sync: local-only. Run rb login before rb sync.\n";
  return `Sync: ${data.pendingLocalChanges} pending local changes, last sync ${data.lastSyncAt ?? "never"}.\n`;
}

function formatExtensionHost(data: ExtensionHostInstallResult): string {
  const lines = data.manifests.map((manifest) =>
    `${manifest.browser}: ${manifest.installed ? "installed" : "missing"} ${manifest.manifestPath}`
  );
  return `${lines.join("\n")}\n`;
}

function appendSourceWarnings(lines: string[], sources: TodayResult["sourceCoverage"]): void {
  const warnings = sources.filter((source) => source.health === "partial" || source.health === "failed");
  for (const warning of warnings) {
    lines.push(`source warning: ${warning.id} is ${warning.health}`);
  }
}
