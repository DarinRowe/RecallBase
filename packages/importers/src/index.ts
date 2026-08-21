import type { ImportResult } from "@recallbase/contracts";
import type { LocalDatabase } from "@recallbase/core";
import { createClaudeCodeImporter } from "./claude-code/importer";
import { createClaudeWebImporter } from "./claude-web/importer";
import { createCodexImporter } from "./codex/importer";
import { createCopilotImporter } from "./copilot/importer";
import { importWithRegistry, type ImportKnownSourcesOptions, type SourceImporter } from "./common/importer";
import { createGrokBuildImporter } from "./grok-build/importer";
import { createKimiCodeImporter } from "./kimi-code/importer";
import { createOpenCodeImporter } from "./opencode/importer";
import { createPiImporter } from "./pi/importer";

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
export { createGrokBuildImporter } from "./grok-build/importer";
export { createKimiCodeImporter } from "./kimi-code/importer";
export { createOpenCodeImporter } from "./opencode/importer";
export { createPiImporter } from "./pi/importer";

export function getDefaultImporters(): SourceImporter[] {
  return [
    createCodexImporter(),
    createClaudeCodeImporter(),
    createClaudeWebImporter(),
    createCopilotImporter(),
    createGrokBuildImporter(),
    createKimiCodeImporter(),
    createOpenCodeImporter(),
    createPiImporter()
  ];
}

export function importKnownSources(db: LocalDatabase, options: ImportKnownSourcesOptions = {}): Promise<ImportResult> {
  return importWithRegistry(db, getDefaultImporters(), options);
}
