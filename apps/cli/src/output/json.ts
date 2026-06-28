import type { ResultEnvelope } from "@recallbase/contracts";

export function formatJson(result: ResultEnvelope<unknown>): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
