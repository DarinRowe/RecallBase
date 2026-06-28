import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { generateDeviceRawKey, type DeviceRawKey } from "@recallbase/core";

export function defaultDeviceKeyPath(): string {
  return join(homedir(), ".recallbase", "device-key.json");
}

export class FileDeviceKeyStore {
  constructor(private readonly path = defaultDeviceKeyPath()) {}

  read(): DeviceRawKey | undefined {
    if (!existsSync(this.path)) return undefined;
    return JSON.parse(readFileSync(this.path, "utf8")) as DeviceRawKey;
  }

  async readOrCreate(): Promise<DeviceRawKey> {
    const existing = this.read();
    if (existing) return existing;
    const key = await generateDeviceRawKey();
    this.write(key);
    return key;
  }

  write(key: DeviceRawKey): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(key, null, 2), { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }

  metadata(key: DeviceRawKey) {
    return {
      id: key.id,
      version: key.version,
      algorithm: key.algorithm,
      createdAt: key.createdAt,
      path: this.path
    };
  }
}
