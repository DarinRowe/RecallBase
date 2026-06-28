import { readFile } from "node:fs/promises";
import type { Diagnostic } from "@recallbase/contracts";
import { fileUri } from "./discovery";
import { malformedJsonlDiagnostic } from "./diagnostics";

export interface JsonlRecord {
  value: Record<string, unknown>;
  raw: string;
  line: number;
  uri: string;
}

export interface JsonlReadResult {
  records: JsonlRecord[];
  diagnostics: Diagnostic[];
}

export async function readJsonl(path: string, sourceId: string): Promise<JsonlReadResult> {
  const diagnostics: Diagnostic[] = [];
  const records: JsonlRecord[] = [];
  const content = await readFile(path, "utf8");
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const lineNumber = index + 1;
    const uri = fileUri(path, `#L${lineNumber}`);
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        records.push({ value: parsed as Record<string, unknown>, raw: line, line: lineNumber, uri });
      } else {
        diagnostics.push(malformedJsonlDiagnostic(sourceId, uri, "JSONL record must be an object"));
      }
    } catch (error) {
      diagnostics.push(malformedJsonlDiagnostic(sourceId, uri, error));
    }
  });

  return { records, diagnostics };
}

export async function readJsonObject(path: string): Promise<{ value: Record<string, unknown>; raw: string }> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON file must contain an object.");
  }
  return { value: parsed as Record<string, unknown>, raw };
}

export function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function asIsoDate(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.length >= 10) return new Date(numeric).toISOString();
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return fallback;
}

export function textFromContent(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === "string") return item;
        const object = asObject(item);
        return asString(object?.text) ?? asString(object?.value) ?? asString(object?.content);
      })
      .filter((item): item is string => Boolean(item))
      .join("\n")
      .trim();
    return text || undefined;
  }
  const object = asObject(value);
  return asString(object?.text) ?? asString(object?.value) ?? asString(object?.content);
}
