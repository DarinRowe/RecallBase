import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../../apps/cli/src/cli";

describe("local CLI workflow", () => {
  test("imports fixtures, queries history, opens detail, checks sources, and backs up", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-local-flow-"));
    const dbPath = join(dir, "recallbase.sqlite");
    const backupPath = join(dir, "backup.json");
    const fixturesRoot = resolve("tests/fixtures/importers");

    const imported = await runCommand(["import", "--json", "--db", dbPath, "--root", fixturesRoot]);
    const today = await runCommand(["today", "--json", "--db", dbPath, "--date", "2026-05-21"]);
    const search = await runCommand(["search", "parser diagnostics", "--json", "--db", dbPath]);
    const sources = await runCommand(["sources", "--json", "--db", dbPath]);
    const searchBody = JSON.parse(search.stdout);
    const opened = await runCommand(["open", searchBody.data.results[0].id, "--json", "--db", dbPath]);
    const backup = await runCommand(["backup", "--json", "--db", dbPath, "--out", backupPath]);

    expect(imported.code).toBe(0);
    expect(JSON.parse(imported.stdout).data.totals.conversations).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(today.stdout).data.keySessions.length).toBeGreaterThan(0);
    expect(searchBody.data.results[0].snippet).toContain("parser diagnostics");
    expect(JSON.parse(opened.stdout).data.messages.length).toBeGreaterThan(0);
    expect(JSON.parse(sources.stdout).data.sources.map((source: { id: string }) => source.id)).toEqual(
      expect.arrayContaining(["codex", "claude-code", "copilot"])
    );
    expect(JSON.parse(backup.stdout).data.path).toBe(backupPath);
    expect(existsSync(backupPath)).toBe(true);
    expect(JSON.parse(readFileSync(backupPath, "utf8")).conversations.length).toBeGreaterThanOrEqual(3);
  });
});
