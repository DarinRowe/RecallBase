import { createHash } from "node:crypto";

export function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableId(prefix: string, parts: Array<string | undefined>): string {
  const joined = parts.filter(Boolean).join("\u001f");
  return `${prefix}_${stableHash(joined).slice(0, 24)}`;
}

export function contentHash(content: string): string {
  return stableHash(content);
}
