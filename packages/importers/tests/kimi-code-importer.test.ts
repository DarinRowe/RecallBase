import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDatabase } from "@recallbase/core";
import type { ImportBatchInput } from "@recallbase/core";
import type { SourceDiscoveryResult, SourceImporter } from "../src";
import { importWithRegistry } from "../src/common/importer";
import { createKimiCodeImporter } from "../src/kimi-code/importer";

const fixtureRoot = resolve(import.meta.dir, "../../../tests/fixtures/importers/kimi-code");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Kimi Code importer", () => {
  test("imports only user-visible prompts and assistant text from the main agent", async () => {
    const importer = createKimiCodeImporter();
    const discovery = await importer.discover({ roots: [fixtureRoot] });
    const batch = await collectKimiImport(importer, discovery);

    expect(discovery.present).toBe(true);
    expect(discovery.paths.map((path) => path.endsWith("state.json") || path.endsWith("wire.jsonl"))).toEqual([true, true]);
    expect(batch.confidence).toBe("stable");

    const conversation = batch.conversations[0]!;
    expect(conversation).toMatchObject({
      upstreamId: "session_fixture",
      title: "RecallBase Kimi Code fixture",
      startedAt: "2026-06-22T17:00:00.000Z",
      updatedAt: "2026-06-22T17:03:00.000Z",
      metadata: {
        format: "wire-jsonl",
        workspaceDirectory: "/workspace/sanitized/kimi-project",
        archived: false,
        sessionVersion: 2,
        fixtureProvenance: "tests/fixtures/importers/kimi-code"
      }
    });
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(conversation.messages[1]).toMatchObject({
      text: "Implemented the importer around the documented wire event stream.",
      modelId: "kimi-for-coding"
    });
    expect(conversation.rawEvidence).toEqual([]);

    const indexedText = conversation.messages.map((message) => message.text).join("\n");
    expect(indexedText).not.toContain("PRIVATE_CHAIN_OF_THOUGHT_SENTINEL");
    expect(indexedText).not.toContain("SECRET_TOOL_ARGUMENT_SENTINEL");
    expect(indexedText).not.toContain("SECRET_TOOL_OUTPUT_SENTINEL");
    expect(indexedText).not.toContain("INTERNAL_INJECTION_SENTINEL");
    expect(indexedText).not.toContain("INTERNAL_REMINDER_SENTINEL");
    expect(indexedText).not.toContain("MIGRATED_PRIVATE_THINKING_SENTINEL");
    expect(indexedText).not.toContain("SUBAGENT_TRANSCRIPT_SENTINEL");

    const local = new LocalDatabase();
    local.importBatch(batch);
    expect(local.search("documented wire event stream")[0]).toMatchObject({ sourceId: "kimi-code" });
    expect(local.search("SECRET_TOOL_OUTPUT_SENTINEL")).toEqual([]);
  });

  test("drops an incomplete trailing wire record without losing the session", async () => {
    const root = await makeSession([
      wireMessage("user", "Keep the complete record."),
      "{\"type\":\"context.append_message\""
    ]);
    const importer = createKimiCodeImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectKimiImport(importer, discovery);

    expect(batch.conversations[0]?.messages.map((message) => message.text)).toEqual(["Keep the complete record."]);
    expect(batch.diagnostics?.some((item) => item.code === "kimi_code_trailing_record_incomplete")).toBe(true);
  });

  test("reports an interior malformed record and continues streaming", async () => {
    const root = await makeSession([
      wireMessage("user", "Message before corruption."),
      "{not-json",
      wireMessage("assistant", "Message after corruption.")
    ]);
    const importer = createKimiCodeImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectKimiImport(importer, discovery);

    expect(batch.conversations[0]?.messages.map((message) => message.text)).toEqual([
      "Message before corruption.",
      "Message after corruption."
    ]);
    expect(batch.diagnostics?.some((item) => item.code === "jsonl_malformed")).toBe(true);
  });

  test("applies undo records so retracted prompts are not indexed", async () => {
    const root = await makeSession([
      wireMessage("user", "Retain this prompt."),
      wireMessage("assistant", "Retain this answer."),
      wireMessage("user", "RETRACTED_PROMPT_SENTINEL"),
      wireMessage("assistant", "RETRACTED_ANSWER_SENTINEL"),
      JSON.stringify({ type: "context.undo", count: 1, time: 1782147800000 })
    ]);
    const importer = createKimiCodeImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectKimiImport(importer, discovery);
    const messages = batch.conversations[0]?.messages.map((message) => message.text);

    expect(messages).toEqual(["Retain this prompt.", "Retain this answer."]);
  });

  test("removes bundled Skill bodies and reconstructs user slash commands", async () => {
    const root = await makeSession([
      JSON.stringify({
        type: "context.append_message",
        message: {
          role: "user",
          content: [
            { type: "text", text: "BUNDLED_SKILL_BODY_SENTINEL" },
            { type: "text", text: "Keep only my direct prompt." }
          ],
          toolCalls: [],
          origin: { kind: "user", skillActivations: [{ skillName: "research" }] }
        },
        time: 1782147601000
      }),
      JSON.stringify({
        type: "context.append_message",
        message: {
          role: "user",
          content: [{ type: "text", text: "EXPANDED_USER_SKILL_SENTINEL" }],
          toolCalls: [],
          origin: { kind: "skill_activation", trigger: "user-slash", skillName: "research", skillArgs: "Kimi sessions" }
        },
        time: 1782147602000
      }),
      JSON.stringify({
        type: "context.append_message",
        message: {
          role: "user",
          content: [{ type: "text", text: "EXPANDED_PLUGIN_COMMAND_SENTINEL" }],
          toolCalls: [],
          origin: { kind: "plugin_command", trigger: "user-slash", pluginId: "demo", commandName: "check", commandArgs: "now" }
        },
        time: 1782147603000
      }),
      JSON.stringify({
        type: "context.append_message",
        message: {
          role: "user",
          content: [{ type: "text", text: "MODEL_ACTIVATED_SKILL_SENTINEL" }],
          toolCalls: [],
          origin: { kind: "skill_activation", trigger: "model-tool", skillName: "internal" }
        },
        time: 1782147604000
      }),
      wireMessage("assistant", "Visible response."),
      JSON.stringify({
        type: "context.append_message",
        message: {
          role: "assistant",
          content: [{ type: "image_url", imageUrl: { url: "PRIVATE_MEDIA_URL_SENTINEL" } }],
          toolCalls: []
        },
        time: 1782147605000
      })
    ]);
    const importer = createKimiCodeImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectKimiImport(importer, discovery);
    const messages = batch.conversations[0]?.messages.map((message) => message.text);

    expect(messages).toEqual([
      "Keep only my direct prompt.",
      "/research Kimi sessions",
      "/demo:check now",
      "Visible response.",
      "[image]"
    ]);
    expect(messages?.join("\n")).not.toContain("SENTINEL");
  });

  test("uses unmatched turn input as a fallback for an interrupted append", async () => {
    const root = await makeSession([
      JSON.stringify({
        type: "turn.prompt",
        input: [{ type: "text", text: "Do not duplicate this complete prompt." }],
        origin: { kind: "user" },
        time: 1782147600000
      }),
      wireMessage("user", "Do not duplicate this complete prompt."),
      JSON.stringify({
        type: "turn.prompt",
        input: [{ type: "text", text: "Recover this interrupted prompt." }],
        origin: { kind: "user" },
        time: 1782147601000
      })
    ]);
    const importer = createKimiCodeImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectKimiImport(importer, discovery);

    expect(batch.conversations[0]?.messages.map((message) => message.text)).toEqual([
      "Do not duplicate this complete prompt.",
      "Recover this interrupted prompt."
    ]);
  });

  test("yields at most one session per import batch", async () => {
    const root = await mkdtemp(join(tmpdir(), "recallbase-kimi-code-batches-"));
    tempDirs.push(root);
    await writeSession(root, "session_a", [wireMessage("user", "First session.")]);
    await writeSession(root, "session_b", [wireMessage("user", "Second session.")]);
    const importer = createKimiCodeImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batches: ImportBatchInput[] = [];

    for await (const batch of importer.importBatchesFromPaths!(discovery.paths, { discovery })) batches.push(batch);

    expect(batches).toHaveLength(2);
    expect(batches.every((batch) => batch.conversations.length <= 1)).toBe(true);
    expect(batches.flatMap((batch) => batch.conversations.map((conversation) => conversation.upstreamId))).toEqual([
      "session_a",
      "session_b"
    ]);
  });

  test("summarizes empty sessions once across streaming batches", async () => {
    const root = await mkdtemp(join(tmpdir(), "recallbase-kimi-code-empty-batches-"));
    tempDirs.push(root);
    const metadata = JSON.stringify({ type: "metadata", protocol_version: "1.5", created_at: 1782147600000 });
    await writeSession(root, "session_empty_a", [metadata]);
    await writeSession(root, "session_empty_b", [metadata]);
    const importer = createKimiCodeImporter();
    const discovery = await importer.discover({ roots: [root] });
    const batch = await collectKimiImport(importer, discovery);
    const emptyDiagnostics = batch.diagnostics?.filter((item) => item.code === "kimi_code_no_messages");

    expect(batch.conversations).toEqual([]);
    expect(emptyDiagnostics).toHaveLength(1);
    expect(emptyDiagnostics?.[0]?.message).toBe("2 Kimi Code sessions had no user-visible messages.");
  });

  test("incrementally imports an appended active session without duplicates", async () => {
    const root = await makeSession([
      wireMessage("user", "Initial prompt."),
      wireMessage("assistant", "Initial answer.")
    ]);
    const wirePath = sessionWirePath(root, "session_temp");
    const importer = createKimiCodeImporter();
    const local = new LocalDatabase();

    const first = await importWithRegistry(local, [importer], { roots: [root], skipUnchanged: true });
    await appendFile(wirePath, `${wireMessage("user", "Appended prompt.")}\n${wireMessage("assistant", "Appended answer.")}\n`);
    const future = new Date(Date.now() + 2_000);
    await utimes(wirePath, future, future);
    const second = await importWithRegistry(local, [importer], { roots: [root], skipUnchanged: true });
    const third = await importWithRegistry(local, [importer], { roots: [root], skipUnchanged: true });
    const count = local.db.query(
      "SELECT COUNT(*) AS count FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.source_id = ?"
    ).get("kimi-code") as { count: number };

    expect(first.totals.conversations).toBe(1);
    expect(second.totals.conversations).toBe(1);
    expect(count.count).toBe(4);
    expect(third.totals).toMatchObject({ conversations: 0, messages: 0 });
  });
});

async function makeSession(lines: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "recallbase-kimi-code-"));
  tempDirs.push(root);
  await writeSession(root, "session_temp", lines);
  return root;
}

async function writeSession(root: string, sessionId: string, lines: string[]): Promise<void> {
  const sessionDir = join(root, "sessions", `wd_${sessionId}`, sessionId);
  await mkdir(join(sessionDir, "agents", "main"), { recursive: true });
  await writeFile(
    join(sessionDir, "state.json"),
    JSON.stringify({
      id: sessionId,
      version: 2,
      cwd: "/workspace/sanitized",
      createdAt: 1782147600000,
      updatedAt: 1782147800000,
      title: "Temporary Kimi Code session"
    })
  );
  await writeFile(join(sessionDir, "agents", "main", "wire.jsonl"), `${lines.join("\n")}\n`);
}

function sessionWirePath(root: string, sessionId: string): string {
  return join(root, "sessions", `wd_${sessionId}`, sessionId, "agents", "main", "wire.jsonl");
}

async function collectKimiImport(
  importer: SourceImporter,
  discovery: SourceDiscoveryResult
): Promise<ImportBatchInput> {
  const batches: ImportBatchInput[] = [];
  for await (const batch of importer.importBatchesFromPaths!(discovery.paths, { discovery })) batches.push(batch);
  const first = batches[0];
  if (!first) throw new Error("Expected Kimi Code importer to yield at least one batch.");
  return {
    ...first,
    conversations: batches.flatMap((batch) => batch.conversations),
    diagnostics: batches.flatMap((batch) => batch.diagnostics ?? [])
  };
}

function wireMessage(role: "user" | "assistant", text: string): string {
  return JSON.stringify({
    type: "context.append_message",
    message: { role, content: [{ type: "text", text }], toolCalls: [], origin: role === "user" ? { kind: "user" } : undefined },
    time: 1782147601000
  });
}
