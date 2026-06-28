import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDatabase } from "@recallbase/core";
import { createClaudeCodeImporter } from "../src/claude-code/importer";

const fixtureRoot = resolve(import.meta.dir, "../../../tests/fixtures/importers/claude-code");

describe("Claude Code importer", () => {
  test("imports project JSONL session messages with diagnostics", async () => {
    const importer = createClaudeCodeImporter();
    const discovery = await importer.discover({ roots: [fixtureRoot] });
    const batch = await importer.importFromPaths(discovery.paths, { discovery });

    expect(discovery.present).toBe(true);
    expect(batch.conversations).toHaveLength(1);
    expect(batch.diagnostics?.some((item) => item.code === "jsonl_malformed")).toBe(true);

    const conversation = batch.conversations[0]!;
    expect(conversation.upstreamId).toBe("claude-session-1");
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "unknown"]);
    expect(conversation.rawEvidence).toEqual([]);
    expect(conversation.messages.some((message) => message.rawEvidenceUri)).toBe(false);
    expect(conversation.metadata?.fixtureProvenance).toBe("tests/fixtures/importers/claude-code");

    const db = new LocalDatabase();
    db.importBatch(batch);
    expect(db.search("malformed JSONL")[0]).toMatchObject({ sourceId: "claude-code" });
    expect(db.sources()[0]).toMatchObject({ confidence: "stable", health: "partial" });
  });

  test("skips Claude Code sessions without importable messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-claude-code-empty-"));
    try {
      const path = join(dir, "session.jsonl");
      await writeFile(path, `${JSON.stringify({ type: "permission-mode", sessionId: "empty-session" })}\n`);

      const importer = createClaudeCodeImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations).toEqual([]);
      expect(batch.diagnostics?.some((item) => item.code === "claude_code_no_messages")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("deduplicates repeated Claude Code messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-claude-code-duplicate-"));
    try {
      const path = join(dir, "session.jsonl");
      const record = {
        type: "user",
        sessionId: "duplicate-session",
        timestamp: "2026-05-21T12:00:00.000Z",
        message: { role: "user", content: "Do not import me twice." }
      };
      await writeFile(path, `${JSON.stringify(record)}\n${JSON.stringify(record)}\n`);

      const importer = createClaudeCodeImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations).toHaveLength(1);
      expect(batch.conversations[0]!.messages).toHaveLength(1);
      expect(batch.conversations[0]!.messages[0]?.text).toBe("Do not import me twice.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("maps queued Claude Code user input to user role", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-claude-code-queue-"));
    try {
      const path = join(dir, "session.jsonl");
      await writeFile(
        path,
        `${JSON.stringify({
          type: "queue-operation",
          operation: "enqueue",
          sessionId: "queue-session",
          timestamp: "2026-05-21T12:00:00.000Z",
          content: "continue"
        })}\n`
      );

      const importer = createClaudeCodeImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations).toHaveLength(1);
      expect(batch.conversations[0]!.messages).toEqual([
        {
          upstreamId: "L1",
          role: "user",
          createdAt: "2026-05-21T12:00:00.000Z",
          text: "continue"
        }
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("prefers Claude Code history display text for titles when available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-claude-code-history-title-"));
    try {
      const claudeRoot = join(dir, ".claude");
      const projectRoot = join(claudeRoot, "projects", "-tmp-project");
      await mkdir(projectRoot, { recursive: true });
      const sessionId = "history-session";
      const path = join(projectRoot, `${sessionId}.jsonl`);
      await writeFile(
        join(claudeRoot, "history.jsonl"),
        `${JSON.stringify({ sessionId, timestamp: 1776308626412, display: "What project is this" })}\n`
      );
      await writeFile(
        path,
        [
          {
            type: "user",
            sessionId,
            timestamp: "2026-05-21T12:00:00.000Z",
            message: { role: "user", content: "# AGENTS.md instructions for /tmp/project\n\nRules." }
          },
          {
            type: "assistant",
            sessionId,
            timestamp: "2026-05-21T12:01:00.000Z",
            message: { role: "assistant", content: "History display should win." }
          }
        ].map((item) => JSON.stringify(item)).join("\n")
      );

      const importer = createClaudeCodeImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations[0]!.title).toBe("What project is this");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
