import { ok, type DeviceKeyResult, type ResultEnvelope } from "@recallbase/contracts";
import { FileDeviceKeyStore } from "../auth/device-key-store";
import type { CommandContext } from "./shared";

export async function keyCommand(context: CommandContext, rest: string[]): Promise<ResultEnvelope<DeviceKeyResult>> {
  const store = new FileDeviceKeyStore(context.flags.deviceKeyPath);
  const key = await store.readOrCreate();
  const metadata = store.metadata(key);

  if (rest[0] === "export") {
    return ok("key", { ...metadata, rawKeyBase64Url: key.rawKeyBase64Url });
  }

  return ok("key", metadata);
}
