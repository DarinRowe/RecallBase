import { createHash } from "node:crypto";
import { access, open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findFiles(
  roots: string[],
  predicate: (path: string) => boolean,
  maxDepth = 6
): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>();

  async function visit(path: string, depth: number): Promise<void> {
    const fullPath = resolve(path);
    if (seen.has(fullPath) || depth > maxDepth) return;
    seen.add(fullPath);

    let info;
    try {
      info = await stat(fullPath);
    } catch {
      return;
    }

    if (info.isFile()) {
      if (predicate(fullPath)) found.push(fullPath);
      return;
    }
    if (!info.isDirectory()) return;

    let entries;
    try {
      entries = await readdir(fullPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await visit(join(fullPath, entry.name), depth + 1);
    }
  }

  for (const root of roots) await visit(root, 0);
  return found.sort();
}

export function fileUri(path: string, fragment?: string): string {
  const url = pathToFileURL(path).toString();
  return fragment === undefined ? url : `${url}${fragment}`;
}

export function schemaFingerprint(parts: unknown[]): string {
  const normalized = parts
    .map((part) => {
      const flattened = flattenForHash(part);
      return JSON.stringify(flattened, Object.keys(flattened).sort());
    })
    .sort()
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export async function fileSchemaFingerprint(paths: string[], sampleBytes = 8192): Promise<string> {
  const samples: string[] = [];
  const buffer = Buffer.alloc(Math.max(0, sampleBytes));
  for (const path of paths.slice(0, 20)) {
    let file;
    try {
      file = await open(path, "r");
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const result = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }
      samples.push(buffer.toString("utf8", 0, bytesRead));
    } catch {
      samples.push(`${path}:unreadable`);
    } finally {
      await file?.close();
    }
  }
  return createHash("sha256").update(samples.join("\n---\n")).digest("hex").slice(0, 16);
}

export function userHome(...parts: string[]): string {
  return join(homedir(), ...parts);
}

export function titleFromText(text: string, fallback: string): string {
  const compact = normalizeTitleText(text);
  if (!compact) return fallback;
  return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
}

export function titleFromMessageTexts(
  preferredTexts: Array<string | undefined>,
  fallbackTexts: Array<string | undefined>,
  fallback: string
): string {
  const preferred = preferredTexts.find((text) => text !== undefined && isTitleCandidate(text));
  if (preferred !== undefined) return titleFromText(preferred, fallback);
  const fallbackText = fallbackTexts.find((text) => text !== undefined && isTitleCandidate(text));
  return titleFromText(fallbackText ?? "", fallback);
}

export function sessionTitleFallback(sourceLabel: string, sessionId: string): string {
  const timestamp = sessionTimestampLabel(sessionId);
  if (timestamp) return `${sourceLabel} session ${timestamp}`;
  const compact = sessionId.length > 24 ? `${sessionId.slice(0, 21)}...` : sessionId;
  return `${sourceLabel} session ${compact}`;
}

function isTitleCandidate(text: string): boolean {
  const compact = normalizeTitleText(text);
  if (!compact) return false;
  return !TITLE_BOILERPLATE_PATTERNS.some((pattern) => pattern.test(compact));
}

function normalizeTitleText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";

  if (/^Repository:\s+/i.test(compact)) {
    const endOfRepository = compact.indexOf(". ");
    if (endOfRepository !== -1) return compact.slice(endOfRepository + 2).trim();
  }

  return compact;
}

const TITLE_BOILERPLATE_PATTERNS = [
  /^# AGENTS\.md instructions for /i,
  /^<permissions instructions>/i,
  /^<environment_context>/i,
  /^<app-context>/i,
  /^<developer instructions>/i,
  /^<skill>/i,
  /^The following is the Codex agent history/i,
  /^# Files mentioned by the user:/i,
  /^## Code review guidelines:/i,
  /^\{\s*"outcome"\s*:/i,
  /^\{\s*"risk_level"\s*:/i
];

function sessionTimestampLabel(sessionId: string): string | undefined {
  const match = /(\d{4}-\d{2}-\d{2})T(\d{2})[-:](\d{2})/.exec(sessionId);
  return match ? `${match[1]} ${match[2]}:${match[3]}` : undefined;
}

export function fileStem(path: string): string {
  const name = basename(path);
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

export function parentName(path: string): string {
  return basename(dirname(path));
}

function flattenForHash(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (value === null || value === undefined) {
    out[prefix || "value"] = String(value);
    return out;
  }
  if (Array.isArray(value)) {
    out[prefix || "array"] = "array";
    if (value[0] !== undefined) flattenForHash(value[0], `${prefix}[]`, out);
    return out;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    out[prefix || "object"] = entries.map(([key]) => key).sort().join(",");
    for (const [key, nested] of entries) {
      if (typeof nested === "object" && nested !== null) flattenForHash(nested, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out[prefix || "value"] = typeof value;
  return out;
}
