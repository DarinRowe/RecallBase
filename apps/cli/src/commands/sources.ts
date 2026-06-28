import { querySources } from "@recallbase/core";
import type { ResultEnvelope, SourcesResult } from "@recallbase/contracts";
import type { CommandContext } from "./shared";

export function sourcesCommand(context: CommandContext): ResultEnvelope<SourcesResult> {
  return querySources(context.db);
}
