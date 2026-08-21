import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { LocalDatabase } from "@recallbase/core";
import { getDefaultImporters, importKnownSources } from "../src";
import { importWithRegistry, type SourceDiscoveryOptions, type SourceImporter } from "../src/common/importer";

const fixtureRoot = resolve(import.meta.dir, "../../../tests/fixtures/importers");

describe("importer registry", () => {
  test("exports all default V1 importers", () => {
    expect(getDefaultImporters().map((importer) => importer.id)).toEqual([
      "codex",
      "claude-code",
      "claude-web",
      "copilot",
      "kimi-code",
      "opencode"
    ]);
  });

  test("imports all known sources into LocalDatabase", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-registry-"));
    try {
      await seedTinyOpenCodeDb(join(dir, "opencode.db"));
      const progress: string[] = [];
      const db = new LocalDatabase();
      const result = await importKnownSources(db, {
        roots: [fixtureRoot, dir],
        onProgress(message) {
          progress.push(message);
        }
      });

      expect(result.sources.map((source) => source.source.id)).toEqual(["codex", "claude-code", "claude-web", "copilot", "kimi-code", "opencode"]);
      expect(result.totals.conversations).toBe(8);
      expect(result.totals.rawEvidence).toBe(0);
      expect(progress.some((message) => message.includes("Importing Codex"))).toBe(true);
      expect(db.sources().map((source) => source.id)).toEqual(["claude-code", "claude-web", "codex", "copilot", "kimi-code", "opencode"]);
      expect(db.search("RecallBase").length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("empty root and source filters do not disable importer defaults", async () => {
    let seenOptions: SourceDiscoveryOptions | undefined = { roots: ["unexpected"] };
    const importer: SourceImporter = {
      id: "fake",
      label: "Fake",
      async discover(options) {
        seenOptions = options;
        return {
          id: "fake",
          label: "Fake",
          paths: [],
          present: false,
          confidence: "stable",
          confidenceReason: "test importer",
          diagnostics: []
        };
      },
      async importFromPaths() {
        throw new Error("Absent importer should not run.");
      }
    };

    const db = new LocalDatabase();
    await importWithRegistry(db, [importer], { roots: [], sourceIds: [] });

    expect(seenOptions).toBeUndefined();
    expect(db.sources()[0]).toMatchObject({ id: "fake", health: "absent" });
  });

  test("skipUnchanged avoids re-importing unchanged sources", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-skip-"));
    try {
      const sourcePath = join(dir, "source.jsonl");
      await writeFile(sourcePath, "{}\n");
      let importCalls = 0;
      const importer: SourceImporter = {
        id: "fake",
        label: "Fake",
        async discover() {
          return {
            id: "fake",
            label: "Fake",
            paths: [sourcePath],
            present: true,
            confidence: "stable",
            confidenceReason: "test importer",
            diagnostics: []
          };
        },
        async importFromPaths() {
          importCalls += 1;
          return {
            sourceId: "fake",
            sourceLabel: "Fake",
            confidence: "stable",
            confidenceReason: "test importer",
            conversations: []
          };
        }
      };

      const db = new LocalDatabase();
      await importWithRegistry(db, [importer], { skipUnchanged: true });
      await importWithRegistry(db, [importer], { skipUnchanged: true });

      expect(importCalls).toBe(1);
      expect(db.sources()[0]).toMatchObject({ id: "fake", health: "healthy" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("summarizes repeated low-value diagnostics before storing source status", async () => {
    const importer: SourceImporter = {
      id: "codex",
      label: "Codex",
      async discover() {
        return {
          id: "codex",
          label: "Codex",
          paths: ["session-a.jsonl", "session-b.jsonl"],
          present: true,
          confidence: "stable",
          confidenceReason: "test importer",
          diagnostics: []
        };
      },
      async importFromPaths() {
        return {
          sourceId: "codex",
          sourceLabel: "Codex",
          confidence: "stable",
          confidenceReason: "test importer",
          conversations: [],
          diagnostics: [
            {
              sourceId: "codex",
              severity: "info",
              code: "codex_events_unmapped",
              message: "3 Codex events were skipped because they did not contain importable messages.",
              evidenceRef: "session-a.jsonl"
            },
            {
              sourceId: "codex",
              severity: "info",
              code: "codex_events_unmapped",
              message: "2 Codex events were skipped because they did not contain importable messages.",
              evidenceRef: "session-b.jsonl"
            }
          ]
        };
      }
    };

    const db = new LocalDatabase();
    const result = await importWithRegistry(db, [importer]);
    const diagnostics = db.sources()[0]!.diagnostics;

    expect(result.totals.diagnostics).toBe(1);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "codex_events_unmapped",
      message: "2 codex_events_unmapped diagnostics were summarized. 5 source events or conversations were skipped."
    });
  });

  test("skipUnchanged bootstraps signatures by importing existing files even with old mtimes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-existing-"));
    try {
      const sourcePath = join(dir, "source.jsonl");
      await writeFile(sourcePath, "{}\n");
      let importCalls = 0;
      const importer: SourceImporter = {
        id: "fake",
        label: "Fake",
        async discover() {
          return {
            id: "fake",
            label: "Fake",
            paths: [sourcePath],
            present: true,
            confidence: "stable",
            confidenceReason: "test importer",
            diagnostics: []
          };
        },
        async importFromPaths() {
          importCalls += 1;
          return {
            sourceId: "fake",
            sourceLabel: "Fake",
            confidence: "stable",
            confidenceReason: "test importer",
            conversations: []
          };
        }
      };

      const db = new LocalDatabase();
      db.importBatch({
        sourceId: "fake",
        sourceLabel: "Fake",
        confidence: "stable",
        confidenceReason: "test importer",
        conversations: []
      });
      await utimes(sourcePath, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));

      await importWithRegistry(db, [importer], { skipUnchanged: true });

      expect(importCalls).toBe(1);
      expect(db.sources()[0]).toMatchObject({ id: "fake", health: "healthy" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("skipUnchanged imports only modified paths after a stored signature", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-partial-"));
    try {
      const oldPath = join(dir, "old.jsonl");
      const newPath = join(dir, "new.jsonl");
      await writeFile(oldPath, "{}\n");
      await writeFile(newPath, "{}\n");
      let importedPaths: string[] = [];
      let discoveredPaths: string[] = [];
      const importer: SourceImporter = {
        id: "fake",
        label: "Fake",
        async discover() {
          return {
            id: "fake",
            label: "Fake",
            paths: [oldPath, newPath],
            present: true,
            confidence: "stable",
            confidenceReason: "test importer",
            diagnostics: []
          };
        },
        async importFromPaths(paths, options) {
          importedPaths = paths;
          discoveredPaths = options?.discovery?.paths ?? [];
          return {
            sourceId: "fake",
            sourceLabel: "Fake",
            confidence: "stable",
            confidenceReason: "test importer",
            conversations: []
          };
        }
      };

      const db = new LocalDatabase();
      await importWithRegistry(db, [importer], { skipUnchanged: true });
      await utimes(oldPath, new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z"));
      await utimes(newPath, new Date("2030-01-01T00:00:00.000Z"), new Date("2030-01-01T00:00:00.000Z"));

      await importWithRegistry(db, [importer], { skipUnchanged: true });
      expect(importedPaths).toEqual([newPath]);
      expect(discoveredPaths).toEqual([newPath]);

      importedPaths = [];
      await importWithRegistry(db, [importer], { skipUnchanged: true });
      expect(importedPaths).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("skipUnchanged works with streaming importers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-stream-skip-"));
    try {
      const sourcePath = join(dir, "source.json");
      await writeFile(sourcePath, "{}\n");
      let importCalls = 0;
      const importer: SourceImporter = {
        id: "fake-stream",
        label: "Fake Stream",
        async discover() {
          return {
            id: "fake-stream",
            label: "Fake Stream",
            paths: [sourcePath],
            present: true,
            confidence: "stable",
            confidenceReason: "test importer",
            diagnostics: []
          };
        },
        async *importBatchesFromPaths() {
          importCalls += 1;
          yield {
            sourceId: "fake-stream",
            sourceLabel: "Fake Stream",
            confidence: "stable",
            confidenceReason: "test importer",
            conversations: []
          };
        }
      };

      const db = new LocalDatabase();
      await importWithRegistry(db, [importer], { skipUnchanged: true });
      await importWithRegistry(db, [importer], { skipUnchanged: true });

      expect(importCalls).toBe(1);
      expect(db.sources()[0]).toMatchObject({ id: "fake-stream", health: "healthy" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function seedTinyOpenCodeDb(path: string): Promise<void> {
  const db = new Database(path, { create: true });
  try {
    db.exec(await readFile(join(fixtureRoot, "opencode", "schema.sql"), "utf8"));
    db.run("INSERT INTO session (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", [
      "registry-session",
      "Registry OpenCode import",
      "2026-05-21T12:00:00.000Z",
      "2026-05-21T12:01:00.000Z"
    ]);
    db.run("INSERT INTO message (id, session_id, role, created_at, content) VALUES (?, ?, ?, ?, ?)", [
      "registry-message",
      "registry-session",
      "user",
      "2026-05-21T12:00:00.000Z",
      "RecallBase registry should include OpenCode."
    ]);
  } finally {
    db.close();
  }
}
