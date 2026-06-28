import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { LocalDatabase } from "@recallbase/core";
import { createOpencodeImporter } from "../src/opencode/importer";

const fixtureRoot = resolve(import.meta.dir, "../../../tests/fixtures/importers/opencode");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("opencode importer", () => {
  test("imports SQLite sessions, messages, parts, and workspace metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-opencode-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "opencode.sqlite");
    await seedOpencodeDb(dbPath);

    const importer = createOpencodeImporter();
    const discovery = await importer.discover({ roots: [dir] });
    const batch = await importer.importFromPaths(discovery.paths, { discovery });

    expect(discovery.present).toBe(true);
    expect(batch.confidence).toBe("experimental");
    expect(batch.diagnostics?.some((item) => item.code === "opencode_experimental")).toBe(true);

    const conversation = batch.conversations[0]!;
    expect(conversation.title).toBe("RecallBase opencode fixture");
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(conversation.messages[1]?.text).toContain("SQLite session/message/part");
    expect(conversation.rawEvidence).toEqual([]);
    expect(conversation.messages.some((message) => message.rawEvidenceUri)).toBe(false);
    expect(conversation.metadata?.workspaceDirectory).toBe("/workspace/sanitized");

    const local = new LocalDatabase();
    local.importBatch(batch);
    expect(local.search("SQLite session")[0]).toMatchObject({ sourceId: "opencode" });
    expect(local.sources()[0]).toMatchObject({ id: "opencode", confidence: "experimental", health: "healthy" });
  });

  test("reports unsupported database schemas as diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-opencode-unsupported-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "opencode.db");
    const db = new Database(dbPath, { create: true });
    db.exec("CREATE TABLE something_else (id TEXT PRIMARY KEY)");
    db.close();

    const importer = createOpencodeImporter();
    const discovery = await importer.discover({ roots: [dir] });
    const batch = await importer.importFromPaths(discovery.paths, { discovery });

    expect(batch.conversations).toEqual([]);
    expect(batch.diagnostics?.some((item) => item.code === "opencode_schema_unsupported")).toBe(true);
  });

  test("skips opencode sessions without importable messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-opencode-empty-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "opencode.sqlite");
    const db = new Database(dbPath, { create: true });
    try {
      db.exec(await readFile(join(fixtureRoot, "schema.sql"), "utf8"));
      db.run(
        "INSERT INTO session (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ["session-empty", "Empty opencode fixture", "2026-05-21T11:00:00.000Z", "2026-05-21T11:00:00.000Z"]
      );
    } finally {
      db.close();
    }

    const importer = createOpencodeImporter();
    const discovery = await importer.discover({ roots: [dir] });
    const batch = await importer.importFromPaths(discovery.paths, { discovery });

    expect(batch.conversations).toEqual([]);
    expect(batch.diagnostics?.some((item) => item.code === "opencode_no_messages")).toBe(true);
  });
});

async function seedOpencodeDb(path: string): Promise<void> {
  const db = new Database(path, { create: true });
  try {
    db.exec(await readFile(join(fixtureRoot, "schema.sql"), "utf8"));
    db.run("INSERT INTO workspace (id, directory) VALUES (?, ?)", ["workspace-1", "/workspace/sanitized"]);
    db.run("INSERT INTO project (id, workspace_id, directory) VALUES (?, ?, ?)", [
      "project-1",
      "workspace-1",
      "/workspace/sanitized/project"
    ]);
    db.run(
      "INSERT INTO session (id, title, workspace_id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["session-1", "RecallBase opencode fixture", "workspace-1", "project-1", "2026-05-21T11:00:00.000Z", "2026-05-21T11:03:00.000Z"]
    );
    db.run("INSERT INTO message (id, session_id, role, created_at, content) VALUES (?, ?, ?, ?, ?)", [
      "message-1",
      "session-1",
      "user",
      "2026-05-21T11:00:00.000Z",
      "Import opencode history."
    ]);
    db.run("INSERT INTO message (id, session_id, role, created_at, content) VALUES (?, ?, ?, ?, ?)", [
      "message-2",
      "session-1",
      "assistant",
      "2026-05-21T11:01:00.000Z",
      null
    ]);
    db.run("INSERT INTO message (id, session_id, role, created_at, content) VALUES (?, ?, ?, ?, ?)", [
      "message-duplicate",
      "session-1",
      "user",
      "2026-05-21T11:00:00.000Z",
      "Import opencode history."
    ]);
    db.run("INSERT INTO part (id, message_id, type, text) VALUES (?, ?, ?, ?)", [
      "part-1",
      "message-2",
      "text",
      "Read SQLite session/message/part rows and preserve evidence."
    ]);
  } finally {
    db.close();
  }
}
