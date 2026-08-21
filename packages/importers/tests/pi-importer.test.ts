import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDatabase } from "@recallbase/core";
import type { ImportBatchInput } from "@recallbase/core";
import type { SourceDiscoveryResult, SourceImporter } from "../src";
import { importWithRegistry } from "../src/common/importer";
import { createPiImporter } from "../src/pi/importer";

const fixtureRoot = resolve(import.meta.dir, "../../../tests/fixtures/importers/pi");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Pi importer", () => {
  test("imports visible messages from the active session-tree branch", async () => {
    const importer = createPiImporter();
    const discovery = await importer.discover({ roots: [fixtureRoot] });
    const batch = await collectImport(importer, discovery);

    expect(discovery.present).toBe(true);
    expect(discovery.paths).toHaveLength(1);
    expect(batch.confidence).toBe("stable");

    const conversation = batch.conversations[0]!;
    expect(conversation).toMatchObject({
      upstreamId: "019f0000-0000-7000-8000-000000000101",
      title: "RecallBase Pi fixture",
      startedAt: "2026-08-21T17:00:00.000Z",
      updatedAt: "2026-08-21T17:01:02.000Z",
      metadata: {
        format: "pi-session-jsonl",
        workspaceDirectory: "/workspace/sanitized/pi-project",
        sessionVersion: 3,
        activeLeafId: "think001",
        currentModelId: "gpt-5.2",
        fixtureProvenance: "tests/fixtures/importers/pi"
      }
    });
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(conversation.messages.map((message) => message.text)).toEqual([
      "Research Pi local sessions.",
      "Implemented the importer around Pi's documented session tree.",
      "Verify branch-aware import.\n[file]\n[image]",
      "Only the active Pi branch is indexed."
    ]);
    expect(conversation.messages[1]).toMatchObject({ upstreamId: "asst0001", modelId: "claude-sonnet-4-5" });
    expect(conversation.rawEvidence).toEqual([]);

    const indexedText = conversation.messages.map((message) => message.text).join("\n");
    expect(indexedText).not.toContain("SENTINEL");

    const local = new LocalDatabase();
    local.importBatch(batch);
    expect(local.search("documented session tree")[0]).toMatchObject({ sourceId: "pi" });
    expect(local.search("SECRET_TOOL_OUTPUT_SENTINEL")).toEqual([]);
    expect(local.search("ABANDONED_ASSISTANT_SENTINEL")).toEqual([]);
    expect(local.search("SECRET_FILE_CONTENT_SENTINEL")).toEqual([]);
  });

  test("honors an explicit leaf cursor instead of importing the last physical branch", async () => {
    const root = await makeSession([
      header(3),
      message("user0001", null, "user", "Kept Pi prompt.", 1787331601000),
      message("asst0001", "user0001", "assistant", "Kept Pi answer.", 1787331602000),
      message("userbad1", "asst0001", "user", "ABANDONED_LEAF_PROMPT_SENTINEL", 1787331603000),
      message("asstbad1", "userbad1", "assistant", "ABANDONED_LEAF_ANSWER_SENTINEL", 1787331604000),
      JSON.stringify({
        type: "leaf",
        id: "leaf0001",
        parentId: "asstbad1",
        timestamp: "2026-08-21T17:00:05.000Z",
        targetId: "asst0001"
      })
    ]);
    const importer = createPiImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectImport(importer, discovery);

    expect(batch.conversations[0]?.messages.map((item) => item.text)).toEqual(["Kept Pi prompt.", "Kept Pi answer."]);
    expect(batch.conversations[0]?.metadata?.activeLeafId).toBe("asst0001");
  });

  test("uses Pi's official session-directory environment override", async () => {
    const root = await makeSession([
      header(3),
      message("user0001", null, "user", "Discover from the configured Pi session directory.", 1787331601000)
    ]);
    const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
    process.env.PI_CODING_AGENT_SESSION_DIR = root;
    try {
      const discovery = await createPiImporter().discover();
      expect(discovery.present).toBe(true);
      expect(discovery.paths).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
      else process.env.PI_CODING_AGENT_SESSION_DIR = previous;
    }
  });

  test("supports legacy linear version 1 sessions with stable line IDs", async () => {
    const root = await makeSession([
      header(1),
      JSON.stringify({ type: "message", timestamp: "2026-08-21T17:00:01.000Z", message: { role: "user", content: "Legacy Pi prompt." } }),
      JSON.stringify({ type: "message", timestamp: "2026-08-21T17:00:02.000Z", message: { role: "toolResult", content: "LEGACY_TOOL_SENTINEL" } }),
      JSON.stringify({ type: "message", timestamp: "2026-08-21T17:00:03.000Z", message: { role: "assistant", content: [{ type: "text", text: "Legacy Pi answer." }], model: "legacy-model" } })
    ]);
    const importer = createPiImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectImport(importer, discovery);

    expect(batch.sourceVersion).toBe("1");
    expect(batch.conversations[0]?.messages).toMatchObject([
      { upstreamId: "line-2", text: "Legacy Pi prompt." },
      { upstreamId: "line-4", text: "Legacy Pi answer.", modelId: "legacy-model" }
    ]);
    expect(batch.conversations[0]?.messages.map((item) => item.text).join("\n")).not.toContain("SENTINEL");
  });

  test("tolerates an active trailing write and reports interior corruption", async () => {
    const root = await makeSession([
      header(3),
      message("user0001", null, "user", "Message before corruption.", 1787331601000),
      "{not-json",
      message("asst0001", "user0001", "assistant", "Message after corruption.", 1787331602000),
      "{\"type\":\"message\""
    ]);
    const importer = createPiImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectImport(importer, discovery);

    expect(batch.conversations[0]?.messages.map((item) => item.text)).toEqual([
      "Message before corruption.",
      "Message after corruption."
    ]);
    expect(batch.diagnostics?.some((item) => item.code === "jsonl_malformed")).toBe(true);
    expect(batch.diagnostics?.some((item) => item.code === "pi_trailing_record_incomplete")).toBe(true);
  });

  test("skips an ambiguous tree instead of importing a partial branch", async () => {
    const root = await makeSession([
      header(3),
      message("user0001", "missing-parent", "user", "AMBIGUOUS_BRANCH_SENTINEL", 1787331601000)
    ]);
    const importer = createPiImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectImport(importer, discovery);

    expect(batch.conversations).toEqual([]);
    expect(batch.diagnostics?.some((item) => item.code === "pi_session_tree_invalid")).toBe(true);
  });

  test("detects unreleased Pi v4 files and reports the incompatible schema", async () => {
    const root = await makeSession([
      JSON.stringify({
        kind: "header",
        version: 4,
        id: "019f0000-0000-7000-8000-000000000400",
        createdAt: 1787331600000,
        cwd: "/workspace/sanitized/pi-project"
      })
    ]);
    const importer = createPiImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectImport(importer, discovery);

    expect(discovery.present).toBe(true);
    expect(batch.conversations).toEqual([]);
    expect(batch.sourceVersion).toBe("4");
    expect(batch.diagnostics?.some((item) => item.code === "pi_session_version_unsupported")).toBe(true);
  });

  test("yields one session per batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "recallbase-pi-batches-"));
    tempDirs.push(root);
    await writeSession(join(root, "first.jsonl"), [header(3, "pi-first"), message("user0001", null, "user", "First Pi session.", 1787331601000)]);
    await writeSession(join(root, "second.jsonl"), [header(3, "pi-second"), message("user0002", null, "user", "Second Pi session.", 1787331661000)]);
    const importer = createPiImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batches: ImportBatchInput[] = [];

    for await (const batch of importer.importBatchesFromPaths!(discovery.paths, { discovery })) batches.push(batch);

    expect(batches).toHaveLength(2);
    expect(batches.every((batch) => batch.conversations.length <= 1)).toBe(true);
  });

  test("incrementally imports an appended active session without duplicates", async () => {
    const root = await makeSession([
      header(3),
      message("user0001", null, "user", "Initial Pi prompt.", 1787331601000),
      message("asst0001", "user0001", "assistant", "Initial Pi answer.", 1787331602000)
    ]);
    const path = join(root, "session.jsonl");
    const importer = createPiImporter();
    const local = new LocalDatabase();

    const first = await importWithRegistry(local, [importer], { roots: [root], skipUnchanged: true });
    await appendFile(
      path,
      `${message("user0002", "asst0001", "user", "Appended Pi prompt.", 1787331661000)}\n${message("asst0002", "user0002", "assistant", "Appended Pi answer.", 1787331662000)}\n`
    );
    const future = new Date(Date.now() + 2_000);
    await utimes(path, future, future);
    const second = await importWithRegistry(local, [importer], { roots: [root], skipUnchanged: true });
    const third = await importWithRegistry(local, [importer], { roots: [root], skipUnchanged: true });
    const count = local.db.query(
      "SELECT COUNT(*) AS count FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.source_id = ?"
    ).get("pi") as { count: number };

    expect(first.totals.conversations).toBe(1);
    expect(second.totals.conversations).toBe(1);
    expect(count.count).toBe(4);
    expect(third.totals).toMatchObject({ conversations: 0, messages: 0 });
  });
});

async function makeSession(lines: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "recallbase-pi-"));
  tempDirs.push(root);
  await writeSession(join(root, "session.jsonl"), lines);
  return root;
}

async function writeSession(path: string, lines: string[]): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${lines.join("\n")}\n`);
}

function header(version: number, id = "019f0000-0000-7000-8000-000000000199"): string {
  return JSON.stringify({
    type: "session",
    version,
    id,
    timestamp: "2026-08-21T17:00:00.000Z",
    cwd: "/workspace/sanitized/pi-project"
  });
}

function message(
  id: string,
  parentId: string | null,
  role: "user" | "assistant",
  text: string,
  timestamp: number
): string {
  const content = role === "assistant" ? [{ type: "text", text }] : text;
  return JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp: new Date(timestamp).toISOString(),
    message: { role, content, timestamp, ...(role === "assistant" ? { provider: "openai", model: "gpt-5.2" } : {}) }
  });
}

async function collectImport(importer: SourceImporter, discovery: SourceDiscoveryResult): Promise<ImportBatchInput> {
  const batches: ImportBatchInput[] = [];
  for await (const batch of importer.importBatchesFromPaths!(discovery.paths, { discovery })) batches.push(batch);
  const first = batches.find((batch) => batch.conversations.length > 0) ?? batches[0];
  if (!first) throw new Error("Expected Pi importer to yield at least one batch.");
  return {
    ...first,
    conversations: batches.flatMap((batch) => batch.conversations),
    diagnostics: batches.flatMap((batch) => batch.diagnostics ?? [])
  };
}
