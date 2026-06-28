import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDatabase } from "@recallbase/core";
import { runCommand } from "../src/cli";

describe("CLI backup", () => {
  test("writes a complete local backup with checksum and counts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-backup-"));
    const dbPath = join(dir, "recallbase.sqlite");
    const backupPath = join(dir, "backup.json");
    const db = new LocalDatabase(dbPath);
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      confidence: "stable",
      confidenceReason: "fixture",
      conversations: [
        {
          sourceId: "codex",
          sourceLabel: "Codex",
          upstreamId: "backup-session",
          title: "Backup fixture",
          startedAt: "2026-05-21T15:00:00.000Z",
          updatedAt: "2026-05-21T15:01:00.000Z",
          rawEvidence: [
            {
              sourceId: "codex",
              uri: "file:///backup/session.jsonl#L1",
              content: "{\"type\":\"user\",\"text\":\"backup me\"}"
            }
          ],
          messages: [
            {
              role: "user",
              createdAt: "2026-05-21T15:00:00.000Z",
              text: "Backup this local conversation.",
              rawEvidenceUri: "file:///backup/session.jsonl#L1"
            }
          ]
        }
      ]
    });
    db.close();

    const result = await runCommand(["backup", "--json", "--db", dbPath, "--out", backupPath]);
    const body = JSON.parse(result.stdout);
    const payload = readFileSync(backupPath, "utf8");
    const backup = JSON.parse(payload);

    expect(result.code).toBe(0);
    expect(existsSync(backupPath)).toBe(true);
    expect(body.data.counts).toMatchObject({ sources: 1, conversations: 1, messages: 1, rawEvidence: 1 });
    expect(body.data.checksumSha256).toBe(createHash("sha256").update(payload).digest("hex"));
    expect(backup.format).toBe("recallbase.local-backup");
    expect(backup.conversations[0].messages[0].text).toContain("Backup this");
    expect(backup.rawEvidence[0].content).toContain("backup me");
  });

  test("default backup writes a SQLite snapshot for large local stores", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-backup-sqlite-"));
    const dbPath = join(dir, "recallbase.sqlite");
    const backupPath = join(dir, "backup.sqlite");
    const db = new LocalDatabase(dbPath);
    db.importBatch({
      sourceId: "codex",
      sourceLabel: "Codex",
      confidence: "stable",
      confidenceReason: "fixture",
      conversations: [
        {
          sourceId: "codex",
          sourceLabel: "Codex",
          upstreamId: "sqlite-backup-session",
          title: "SQLite backup fixture",
          startedAt: "2026-05-21T15:00:00.000Z",
          updatedAt: "2026-05-21T15:01:00.000Z",
          rawEvidence: [],
          messages: [{ role: "user", createdAt: "2026-05-21T15:00:00.000Z", text: "Backup as SQLite." }]
        }
      ]
    });
    db.close();

    const result = await runCommand(["backup", "--json", "--db", dbPath, "--out", backupPath]);
    const body = JSON.parse(result.stdout);
    const checksum = createHash("sha256").update(readFileSync(backupPath)).digest("hex");
    const copied = new LocalDatabase(backupPath);

    expect(result.code).toBe(0);
    expect(body.data.counts).toMatchObject({ sources: 1, conversations: 1, messages: 1 });
    expect(body.data.checksumSha256).toBe(checksum);
    expect(copied.search("SQLite")).toHaveLength(1);
    copied.close();
  });
});
