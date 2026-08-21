import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SavedChromiumTargets {
  schemaVersion: 1;
  userDataDirs: string[];
  registryRoots: string[];
  ignoredRegistryRoots: string[];
}

export function emptySavedChromiumTargets(): SavedChromiumTargets {
  return { schemaVersion: 1, userDataDirs: [], registryRoots: [], ignoredRegistryRoots: [] };
}

export function loadSavedChromiumTargets(path: string): SavedChromiumTargets {
  if (!existsSync(path)) return emptySavedChromiumTargets();
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || !isStringArray(value.userDataDirs)
    || !isStringArray(value.registryRoots)
    || (value.ignoredRegistryRoots !== undefined && !isStringArray(value.ignoredRegistryRoots))) {
    throw new Error(`Invalid saved Chromium target configuration at ${path}.`);
  }
  return {
    schemaVersion: 1,
    userDataDirs: uniqueSorted(value.userDataDirs),
    registryRoots: uniqueSorted(value.registryRoots),
    ignoredRegistryRoots: uniqueSorted(value.ignoredRegistryRoots ?? [])
  };
}

export function saveChromiumTargets(path: string, targets: SavedChromiumTargets): void {
  mkdirSync(dirname(path), { recursive: true });
  const normalized: SavedChromiumTargets = {
    schemaVersion: 1,
    userDataDirs: uniqueSorted(targets.userDataDirs),
    registryRoots: uniqueSorted(targets.registryRoots),
    ignoredRegistryRoots: uniqueSorted(targets.ignoredRegistryRoots)
  };
  const temporaryPath = join(dirname(path), `.${process.pid}.${Date.now()}.native-host-targets.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
