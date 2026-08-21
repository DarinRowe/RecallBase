import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "@recallbase/core";
import { defaultArgv, runCommand } from "../src/cli";

describe("CLI human output", () => {
  test("reports the package version without opening the database", async () => {
    const result = await runCommand(["--version"], { ...process.env, RECALLBASE_DB: "/not/a/real/database.sqlite" });

    expect(result).toEqual({ code: 0, stdout: "recallbase 0.1.5\n" });
  });

  test("shows subcommand help without opening the database or searching", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "rb-search-help-")), "recallbase.sqlite");
    const result = await runCommand(["search", "--help"], { ...process.env, RECALLBASE_DB: dbPath });

    expect(result).toEqual({
      code: 0,
      stdout: "Usage: rb search <query> [--source <source-id>] [--date YYYY-MM-DD] [--limit 1-50] [--json]\n"
    });
    expect(existsSync(dbPath)).toBe(false);
  });

  test("native-host verification does not initialize the local database", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "rb-verify-no-db-")), "recallbase.sqlite");

    await runCommand(["extension", "verify-host", "--json"], { ...process.env, RECALLBASE_DB: dbPath });

    expect(existsSync(dbPath)).toBe(false);
  });

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
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).error.code).toBe("invalid_arguments");
  });

  test("copied Windows native host executable defaults to extension-host mode", () => {
    expect(defaultArgv(["bun", "C:\\Users\\Example\\.recallbase\\extension-host.exe", "--parent-window=42"])).toEqual([
      "extension-host",
      "--parent-window=42"
    ]);
  });

  test("human search shows plain-text metadata and a usable open command", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "rb-human-search-")), "db.sqlite");
    const db = new LocalDatabase(path);
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      confidence: "stable",
      confidenceReason: "test fixture",
      conversations: [
        {
          sourceId: "codex",
          sourceLabel: "Codex",
          upstreamId: "human-search",
          title: "Deployment rollback",
          startedAt: "2026-06-28T07:00:00.000Z",
          updatedAt: "2026-06-28T07:05:00.000Z",
          rawEvidence: [],
          messages: [
            { role: "user", createdAt: "2026-06-28T07:00:00.000Z", text: "The deployment failed, should we rollback?" }
          ]
        }
      ]
    });
    db.close();

    const result = await runCommand(["search", "rollback", "--db", path]);
    const searchBody = JSON.parse((await runCommand(["search", "rollback", "--json", "--db", path])).stdout);
    const id = searchBody.data.results[0].id;

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Deployment rollback");
    expect(result.stdout).toContain("[Codex]");
    expect(result.stdout).toContain("1 message");
    expect(result.stdout).toContain(`open: rb open ${id}`);
    expect(result.stdout).toContain("Run the open command shown under a result to view the full conversation.");
    expect(result.stdout).not.toContain("\x1b");

    const windowed = await runCommand([
      "open",
      id,
      "--message",
      searchBody.data.results[0].matchedMessageId,
      "--context",
      "0",
      "--db",
      path
    ]);
    expect(windowed.stdout).toContain("window: 1 of 1 messages around msg_");
  });
});
