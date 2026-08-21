import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "@recallbase/core";
import { createCursorImporter } from "../src/cursor/importer";

const tempDirs: string[] = [];
const MAIN_ID = "123e4567-e89b-42d3-a456-426614174000";
const INVALID_ID = "223e4567-e89b-42d3-a456-426614174001";
const EMPTY_ID = "323e4567-e89b-42d3-a456-426614174002";
const ESCAPE_ID = "423e4567-e89b-42d3-a456-426614174003";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Cursor importer", () => {
  test("streams and deduplicates main Desktop/CLI transcripts while excluding internal blocks", async () => {
    const root = await fixtureRoot();
    const shorter = await writeTranscript(root, "project-a", MAIN_ID, [message("user", text("Import Cursor history."))]);
    const preferred = await writeTranscript(root, "project-b", MAIN_ID, [
      message("user", text("Import Cursor history."), { futureField: true }),
      message("assistant", text("First visible block."), { type: "tool_use", input: { secret: "tool payload" } }, text("Second visible block.")),
      { type: "status", status: "complete", error: "private runtime error" }
    ]);
    await utimes(shorter, new Date("2026-08-20T00:00:00Z"), new Date("2026-08-20T00:00:00Z"));
    await utimes(preferred, new Date("2026-08-21T00:00:00Z"), new Date("2026-08-21T00:00:00Z"));
    const subagentDir = join(root, "project-b", "agent-transcripts", MAIN_ID, "subagents");
    await mkdir(subagentDir, { recursive: true });
    await writeFile(join(subagentDir, `${ESCAPE_ID}.jsonl`), JSON.stringify(message("assistant", text("subagent secret"))));

    const importer = createCursorImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await importer.importFromPaths!(discovery.paths, { discovery });

    expect(discovery).toMatchObject({ present: true, label: "Cursor", confidence: "experimental" });
    expect(discovery.paths).toHaveLength(2);
    expect(batch.conversations).toHaveLength(1);
    expect(batch.conversations[0]).toMatchObject({ upstreamId: MAIN_ID, title: "Import Cursor history." });
    expect(batch.conversations[0]?.messages.map((item) => [item.role, item.text])).toEqual([
      ["user", "Import Cursor history."],
      ["assistant", "First visible block.\nSecond visible block."]
    ]);
    const allText = batch.conversations[0]?.messages.map((item) => item.text).join("\n") ?? "";
    expect(allText).not.toContain("tool payload");
    expect(allText).not.toContain("runtime error");
    expect(allText).not.toContain("subagent secret");
    expect(batch.diagnostics?.find((item) => item.code === "cursor_duplicates_deduplicated")?.message).toStartWith("1 ");

    const local = new LocalDatabase();
    local.importBatch(batch);
    expect(local.search("visible block")).toHaveLength(1);
    expect(local.search("tool payload")).toEqual([]);
  });

  test("imports a complete prefix when the trailing JSON record is incomplete", async () => {
    const root = await fixtureRoot();
    const path = await writeTranscript(root, "project", MAIN_ID, [message("user", text("Complete prefix."))], false);
    await writeFile(path, `${JSON.stringify(message("user", text("Complete prefix.")))}\n{"role":"assistant"`);

    const importer = createCursorImporter();
    const discovery = await importer.discover({ roots: [path] });
    const batch = await importer.importFromPaths!(discovery.paths, { discovery });

    expect(batch.conversations[0]?.messages.map((item) => item.text)).toEqual(["Complete prefix."]);
    expect(batch.diagnostics?.find((item) => item.code === "cursor_trailing_incomplete")?.message).toStartWith("1 ");
  });

  test("skips malformed interior transcripts and reports only bounded counts", async () => {
    const root = await fixtureRoot();
    const path = await writeTranscript(root, "project", INVALID_ID, [], false);
    await writeFile(path, `${JSON.stringify(message("user", text("Before corruption.")))}\n{bad json}\n${JSON.stringify(message("assistant", text("After corruption.")))}\n`);

    const importer = createCursorImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await importer.importFromPaths!(discovery.paths, { discovery });
    const invalid = batch.diagnostics?.find((item) => item.code === "cursor_transcript_invalid");

    expect(batch.conversations).toEqual([]);
    expect(invalid?.message).toBe("1 Cursor transcript files had malformed interior records or incompatible message fields and were skipped.");
    expect(invalid?.evidenceRef).toBeUndefined();
  });

  test("tolerates unknown blocks, reports empty transcripts, and skips symlink escapes", async () => {
    const root = await fixtureRoot();
    await writeTranscript(root, "project", MAIN_ID, [message("user", text("Known text."), { type: "future_block", payload: "private future payload" })]);
    await writeTranscript(root, "project", EMPTY_ID, [{ type: "status", status: "complete" }]);
    const outside = await fixtureRoot();
    await writeTranscript(outside, "external", ESCAPE_ID, [message("user", text("escaped secret"))]);
    await symlink(join(outside, "external"), join(root, "linked-project"));

    const importer = createCursorImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await importer.importFromPaths!(discovery.paths, { discovery });

    expect(discovery.paths).toHaveLength(2);
    expect(batch.conversations.map((item) => item.upstreamId)).toEqual([MAIN_ID]);
    expect(batch.conversations[0]?.messages[0]?.text).toBe("Known text.");
    expect(batch.diagnostics?.find((item) => item.code === "cursor_schema_unknown")?.message).toStartWith("1 ");
    expect(batch.diagnostics?.find((item) => item.code === "cursor_no_messages")?.message).toStartWith("1 ");
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "recallbase-cursor-"));
  tempDirs.push(root);
  return root;
}

async function writeTranscript(root: string, project: string, id: string, records: unknown[], finalNewline = true): Promise<string> {
  const dir = join(root, project, "agent-transcripts", id);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  const content = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(path, content && finalNewline ? `${content}\n` : content);
  return path;
}

function message(role: "user" | "assistant", ...content: unknown[]): unknown {
  return { role, message: { content } };
}

function text(value: string): unknown {
  return { type: "text", text: value };
}
