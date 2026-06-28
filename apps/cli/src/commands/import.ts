import { ok, type ResultEnvelope, type ImportResult } from "@recallbase/contracts";
import type { CommandContext } from "./shared";

export async function importCommand(context: CommandContext): Promise<ResultEnvelope<ImportResult>> {
  const { importKnownSources } = await import("@recallbase/importers");
  const options: NonNullable<Parameters<typeof importKnownSources>[1]> = {};
  if (context.flags.roots.length > 0) options.roots = context.flags.roots;
  if (context.flags.sourceIds.length > 0) options.sourceIds = context.flags.sourceIds;
  if (!context.flags.json) {
    options.onProgress = (message: string) => {
      process.stderr.write(`${message}\n`);
    };
  }
  return ok("import", await importKnownSources(context.db, options));
}
