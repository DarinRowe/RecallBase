import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDatabase } from "@recallbase/core";
import type { ImportBatchInput } from "@recallbase/core";
import type { SourceDiscoveryResult, SourceImporter } from "../src";
import { importWithRegistry } from "../src/common/importer";
import { createGrokBuildImporter } from "../src/grok-build/importer";

const fixtureRoot = resolve(import.meta.dir, "../../../tests/fixtures/importers/grok-build");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Grok Build importer", () => {
  test("imports only user-visible ACP message chunks", async () => {
    const importer = createGrokBuildImporter();
    const discovery = await importer.discover({ roots: [fixtureRoot] });
    const batch = await collectImport(importer, discovery);

    expect(discovery.present).toBe(true);
    expect(discovery.paths.map((path) => path.endsWith("summary.json") || path.endsWith("updates.jsonl"))).toEqual([true, true]);
    expect(batch.confidence).toBe("stable");

    const conversation = batch.conversations[0]!;
    expect(conversation).toMatchObject({
      upstreamId: "019f0000-0000-7000-8000-000000000001",
      title: "RecallBase Grok Build fixture",
      startedAt: "2026-08-20T17:00:00.000Z",
      updatedAt: "2026-08-20T17:03:00.000Z",
      metadata: {
        format: "grok-acp-updates-jsonl",
        workspaceDirectory: "/workspace/sanitized/grok-project",
        currentModelId: "grok-code-fast-1",
        chatFormatVersion: 1,
        fixtureProvenance: "tests/fixtures/importers/grok-build"
      }
    });
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(conversation.messages[0]).toMatchObject({
      createdAt: "2026-08-20T17:00:00.000Z",
      text: "Research Grok Build local sessions."
    });
    expect(conversation.messages[1]).toMatchObject({
      text: "Implemented the importer from the authoritative ACP update stream.",
      modelId: "grok-code-fast-1"
    });
    expect(conversation.messages[2]?.text).toBe("Verify incremental import.");
    expect(conversation.rawEvidence).toEqual([]);

    const indexedText = conversation.messages.map((message) => message.text).join("\n");
    expect(indexedText).not.toContain("SENTINEL");

    const local = new LocalDatabase();
    local.importBatch(batch);
    expect(local.search("authoritative ACP update stream")[0]).toMatchObject({ sourceId: "grok-build" });
    expect(local.search("SECRET_TOOL_OUTPUT_SENTINEL")).toEqual([]);
  });

  test("uses GROK_HOME for default discovery", async () => {
    const root = await makeSession([
      update("user_message_chunk", "Discover from the configured Grok home.", 1787245200)
    ]);
    const previous = process.env.GROK_HOME;
    process.env.GROK_HOME = root;
    try {
      const discovery = await createGrokBuildImporter().discover();
      expect(discovery.present).toBe(true);
      expect(discovery.paths).toHaveLength(2);
    } finally {
      if (previous === undefined) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = previous;
    }
  });

  test("tolerates an active trailing write and reports interior corruption", async () => {
    const root = await makeSession([
      update("user_message_chunk", "Message before corruption.", 1787245200),
      "{not-json",
      update("agent_message_chunk", "Message after corruption.", 1787245260),
      "{\"method\":\"session/update\""
    ]);
    const importer = createGrokBuildImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectImport(importer, discovery);

    expect(batch.conversations[0]?.messages.map((message) => message.text)).toEqual([
      "Message before corruption.",
      "Message after corruption."
    ]);
    expect(batch.diagnostics?.some((item) => item.code === "jsonl_malformed")).toBe(true);
    expect(batch.diagnostics?.some((item) => item.code === "grok_build_trailing_record_incomplete")).toBe(true);
  });

  test("reconstructs chunks, filters phantom prompts, and applies rewind markers", async () => {
    const root = await makeSession([
      update("user_message_chunk", "Legacy ", 1787245200),
      update("user_message_chunk", "prompt.", 1787245200),
      update("agent_message_chunk", "First ", 1787245260),
      update("agent_thought_chunk", "PRIVATE_THOUGHT_SENTINEL", 1787245260),
      update("agent_message_chunk", "answer.", 1787245260),
      controlUpdate("rewind_marker", { target_prompt_index: -1 }, 1787245261),
      update("user_message_chunk", "ABANDONED_PROMPT_SENTINEL", 1787245320, { promptIndex: 1 }),
      update("user_message_chunk", "PHANTOM_HOST_PROMPT_SENTINEL", 1787245320),
      update("agent_message_chunk", "ABANDONED_ANSWER_SENTINEL", 1787245320),
      controlUpdate("rewind_marker", { target_prompt_index: 1 }, 1787245321),
      legacyUpdate("user_message_chunk", "Replacement prompt.", { promptIndex: 1 }),
      update("agent_message_chunk", "Replacement answer.", 1787245380)
    ]);
    const importer = createGrokBuildImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectImport(importer, discovery);

    expect(batch.conversations[0]?.messages.map((message) => message.text)).toEqual([
      "Legacy prompt.",
      "First answer.",
      "Replacement prompt.",
      "Replacement answer."
    ]);
    expect(batch.conversations[0]?.messages.map((message) => message.text).join("\n")).not.toContain("SENTINEL");
  });

  test("skips hidden subagents unless visibility is explicitly enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "recallbase-grok-build-hidden-"));
    tempDirs.push(root);
    await writeSession(root, "019f0000-0000-7000-8000-000000000020", [
      update("user_message_chunk", "HIDDEN_SUBAGENT_SENTINEL", 1787245200)
    ], { session_kind: "subagent:explore" });
    await writeSession(root, "019f0000-0000-7000-8000-000000000021", [
      update("user_message_chunk", "Explicitly visible child.", 1787245260)
    ], { session_kind: "subagent:review", hidden: false, parent_session_id: "parent-session" });
    const importer = createGrokBuildImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectImport(importer, discovery);

    expect(batch.conversations).toHaveLength(1);
    expect(batch.conversations[0]).toMatchObject({
      upstreamId: "019f0000-0000-7000-8000-000000000021",
      metadata: { sessionKind: "subagent:review", parentSessionId: "parent-session" }
    });
  });

  test("yields one session per batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "recallbase-grok-build-batches-"));
    tempDirs.push(root);
    await writeSession(root, "019f0000-0000-7000-8000-000000000010", [
      update("user_message_chunk", "First Grok session.", 1787245200)
    ]);
    await writeSession(root, "019f0000-0000-7000-8000-000000000011", [
      update("user_message_chunk", "Second Grok session.", 1787245260)
    ]);
    const importer = createGrokBuildImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batches: ImportBatchInput[] = [];

    for await (const batch of importer.importBatchesFromPaths!(discovery.paths, { discovery })) batches.push(batch);

    expect(batches).toHaveLength(2);
    expect(batches.every((batch) => batch.conversations.length <= 1)).toBe(true);
  });

  test("incrementally imports an appended active session without duplicates", async () => {
    const root = await makeSession([
      update("user_message_chunk", "Initial Grok prompt.", 1787245200),
      update("agent_message_chunk", "Initial Grok answer.", 1787245260)
    ]);
    const updatesPath = sessionUpdatesPath(root, "019f0000-0000-7000-8000-000000000099");
    const importer = createGrokBuildImporter();
    const local = new LocalDatabase();

    const first = await importWithRegistry(local, [importer], { roots: [root], skipUnchanged: true });
    await appendFile(
      updatesPath,
      `${update("user_message_chunk", "Appended Grok prompt.", 1787245320)}\n${update("agent_message_chunk", "Appended Grok answer.", 1787245380)}\n`
    );
    const future = new Date(Date.now() + 2_000);
    await utimes(updatesPath, future, future);
    const second = await importWithRegistry(local, [importer], { roots: [root], skipUnchanged: true });
    const third = await importWithRegistry(local, [importer], { roots: [root], skipUnchanged: true });
    const count = local.db.query(
      "SELECT COUNT(*) AS count FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.source_id = ?"
    ).get("grok-build") as { count: number };

    expect(first.totals.conversations).toBe(1);
    expect(second.totals.conversations).toBe(1);
    expect(count.count).toBe(4);
    expect(third.totals).toMatchObject({ conversations: 0, messages: 0 });
  });
});

async function makeSession(lines: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "recallbase-grok-build-"));
  tempDirs.push(root);
  await writeSession(root, "019f0000-0000-7000-8000-000000000099", lines);
  return root;
}

async function writeSession(
  root: string,
  sessionId: string,
  lines: string[],
  summaryOverrides: Record<string, unknown> = {}
): Promise<void> {
  const sessionDir = join(root, "sessions", "%2Fworkspace%2Fsanitized", sessionId);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, "summary.json"), JSON.stringify({
    info: { id: sessionId, cwd: "/workspace/sanitized" },
    generated_title: "Temporary Grok Build session",
    created_at: "2026-08-20T17:00:00.000Z",
    updated_at: "2026-08-20T17:03:00.000Z",
    current_model_id: "grok-code-fast-1",
    chat_format_version: 1,
    ...summaryOverrides
  }));
  await writeFile(join(sessionDir, "updates.jsonl"), `${lines.join("\n")}\n`);
}

function sessionUpdatesPath(root: string, sessionId: string): string {
  return join(root, "sessions", "%2Fworkspace%2Fsanitized", sessionId, "updates.jsonl");
}

function update(kind: string, text: string, timestamp: number, updateMeta?: Record<string, unknown>): string {
  return JSON.stringify({
    method: "session/update",
    params: {
      sessionId: "019f0000-0000-7000-8000-000000000099",
      update: { sessionUpdate: kind, content: { type: "text", text }, ...(updateMeta ? { _meta: updateMeta } : {}) }
    },
    timestamp
  });
}

function controlUpdate(kind: string, fields: Record<string, unknown>, timestamp: number): string {
  return JSON.stringify({
    method: "_x.ai/session/update",
    params: { sessionId: "019f0000-0000-7000-8000-000000000099", update: { sessionUpdate: kind, ...fields } },
    timestamp
  });
}

function legacyUpdate(kind: string, text: string, updateMeta?: Record<string, unknown>): string {
  return JSON.stringify({
    sessionId: "019f0000-0000-7000-8000-000000000099",
    update: { sessionUpdate: kind, content: { type: "text", text }, ...(updateMeta ? { _meta: updateMeta } : {}) }
  });
}

async function collectImport(
  importer: SourceImporter,
  discovery: SourceDiscoveryResult
): Promise<ImportBatchInput> {
  const batches: ImportBatchInput[] = [];
  for await (const batch of importer.importBatchesFromPaths!(discovery.paths, { discovery })) batches.push(batch);
  const first = batches[0];
  if (!first) throw new Error("Expected Grok Build importer to yield at least one batch.");
  return {
    ...first,
    conversations: batches.flatMap((batch) => batch.conversations),
    diagnostics: batches.flatMap((batch) => batch.diagnostics ?? [])
  };
}
