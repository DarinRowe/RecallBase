import type { ImportResult } from "@recallbase/contracts";
import type { LocalDatabase } from "@recallbase/core";
import { createClaudeCodeImporter } from "./claude-code/importer";
import { createClaudeWebImporter } from "./claude-web/importer";
import { createCodexImporter } from "./codex/importer";
import { createCopilotImporter } from "./copilot/importer";
import { importWithRegistry, type ImportKnownSourcesOptions, type SourceImporter } from "./common/importer";
import { createOpencodeImporter } from "./opencode/importer";

export type {
  ImportKnownSourcesOptions,
  SourceDiscoveryOptions,
  SourceDiscoveryResult,
  SourceImporter
} from "./common/importer";
export { createClaudeCodeImporter } from "./claude-code/importer";
export { createClaudeWebImporter } from "./claude-web/importer";
export { createCodexImporter } from "./codex/importer";
export { createCopilotImporter } from "./copilot/importer";
export { createOpencodeImporter } from "./opencode/importer";

export function getDefaultImporters(): SourceImporter[] {
  return [createCodexImporter(), createClaudeCodeImporter(), createClaudeWebImporter(), createCopilotImporter(), createOpencodeImporter()];
}

export function importKnownSources(db: LocalDatabase, options: ImportKnownSourcesOptions = {}): Promise<ImportResult> {
  return importWithRegistry(db, getDefaultImporters(), options);
}
