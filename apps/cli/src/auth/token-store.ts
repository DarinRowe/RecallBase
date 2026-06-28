import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface StoredToken {
  accessToken: string;
  userId: string;
  expiresAt: string;
}

export function defaultTokenPath(): string {
  return join(homedir(), ".recallbase", "auth.json");
}

export class FileTokenStore {
  constructor(private readonly path = defaultTokenPath()) {}

  read(): StoredToken | undefined {
    if (!existsSync(this.path)) return undefined;
    return JSON.parse(readFileSync(this.path, "utf8")) as StoredToken;
  }

  write(token: StoredToken): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(token, null, 2), { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}
