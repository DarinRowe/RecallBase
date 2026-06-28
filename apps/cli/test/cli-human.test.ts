import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "@recallbase/core";
import { defaultArgv, runCommand } from "../src/cli";

describe("CLI human output", () => {
  test("empty today points to import without JSON ceremony", async () => {
    const result = await runCommand(["today", "--db", ":memory:"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No imported sessions");
  });

  test("unknown open id gives a concise error", async () => {
    const result = await runCommand(["open", "missing", "--db", ":memory:"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Conversation was not found");
  });

  test("unknown commands use the unknown envelope command", async () => {
    const result = await runCommand(["typo", "--json", "--db", ":memory:"]);

    expect(JSON.parse(result.stdout).meta.command).toBe("unknown");
    expect(JSON.parse(result.stdout).error.details.attemptedCommand).toBe("typo");
  });

  test("empty search validates before query-time refresh", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "rb-empty-search-")), "db.sqlite");
    const result = await runCommand(["search", "--json"], { ...process.env, RECALLBASE_DB: dbPath });
    const db = new LocalDatabase(dbPath);
    try {
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout).error.code).toBe("invalid_arguments");
      expect(db.getSyncState("cli:auto_refresh:last_import_at")).toBeUndefined();
    } finally {
      db.close();
    }
  });

  test("copied Windows native host executable defaults to extension-host mode", () => {
    expect(defaultArgv(["bun", "C:\\Users\\Example\\.recallbase\\extension-host.exe", "--parent-window=42"])).toEqual([
      "extension-host",
      "--parent-window=42"
    ]);
  });
});
