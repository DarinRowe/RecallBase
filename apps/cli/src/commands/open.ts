import { queryOpen, type OpenConversationOptions } from "@recallbase/core";
import type { CommandContext } from "./shared";

export function openCommand(context: CommandContext, rest: string[]) {
  const options: OpenConversationOptions = {};
  if (context.flags.messageId !== undefined) options.messageId = context.flags.messageId;
  if (context.flags.context !== undefined) options.context = context.flags.context;
  return queryOpen(context.db, rest[0] ?? "", options);
}
