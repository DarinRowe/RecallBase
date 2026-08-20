import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../../apps/cli/src/cli";

describe("local CLI workflow", () => {
  test("skips unchanged history on repeated imports unless forced", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-incremental-import-"));
    const dbPath = join(dir, "recallbase.sqlite");
    const fixturesRoot = resolve("tests/fixtures/importers");

    try {
      const first = JSON.parse(
        (await runCommand(["import", "--json", "--db", dbPath, "--root", fixturesRoot])).stdout
      );
      const second = JSON.parse(
        (await runCommand(["import", "--json", "--db", dbPath, "--root", fixturesRoot])).stdout
      );
      const forced = JSON.parse(
        (await runCommand(["import", "--force", "--json", "--db", dbPath, "--root", fixturesRoot])).stdout
      );

      expect(first.data.totals.conversations).toBeGreaterThan(0);
      expect(second.data.totals).toMatchObject({ conversations: 0, messages: 0 });
      expect(
        second.data.sources.every((source: { changedConversations: number }) => source.changedConversations === 0)
      ).toBe(true);
      expect(forced.data.totals.conversations).toBe(first.data.totals.conversations);
      expect(forced.data.totals.messages).toBe(first.data.totals.messages);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
