import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDatabase } from "@recallbase/core";
import { createCodexImporter } from "../src/codex/importer";

const fixtureRoot = resolve(import.meta.dir, "../../../tests/fixtures/importers/codex");

describe("Codex importer", () => {
  test("discovers and imports Codex JSONL messages with diagnostics", async () => {
    const importer = createCodexImporter();
    const discovery = await importer.discover({ roots: [fixtureRoot] });

    expect(discovery.present).toBe(true);
    expect(discovery.schemaFingerprint).toBeString();

    const batch = await importer.importFromPaths(discovery.paths, { discovery });
    expect(batch.conversations).toHaveLength(1);
    expect(batch.confidence).toBe("stable");
    expect(batch.diagnostics?.some((item) => item.code === "jsonl_malformed")).toBe(true);

    const conversation = batch.conversations[0]!;
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
    expect(conversation.messages).toHaveLength(3);
    expect(conversation.rawEvidence).toEqual([]);
    expect(conversation.messages.some((message) => message.rawEvidenceUri)).toBe(false);

    const db = new LocalDatabase();
    db.importBatch(batch);
    expect(db.search("parser diagnostics")[0]).toMatchObject({ sourceId: "codex" });
    expect(db.sources()[0]).toMatchObject({ id: "codex", health: "partial", confidence: "stable" });
  });

  test("does not match sibling JSONL files just because an ancestor is a Codex worktree", async () => {
    const importer = createCodexImporter();
    const discovery = await importer.discover({ roots: [resolve(import.meta.dir, "../../../tests/fixtures/importers")] });

    expect(discovery.paths).toHaveLength(1);
    expect(discovery.paths[0]).toContain("/codex/sessions/");
  });

  test("matches default Codex session roots and ignores nearby decoys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-codex-paths-"));
    try {
      await mkdir(join(dir, ".codex", "sessions", "2026", "05", "25"), { recursive: true });
      await mkdir(join(dir, ".codex", "archived_sessions", "2026", "05", "25"), { recursive: true });
      await mkdir(join(dir, ".codex", "logs"), { recursive: true });
      await writeFile(join(dir, ".codex", "sessions", "2026", "05", "25", "session.jsonl"), "{}\n");
      await writeFile(join(dir, ".codex", "archived_sessions", "2026", "05", "25", "archived.jsonl"), "{}\n");
      await writeFile(join(dir, ".codex", "logs", "not-a-session.jsonl"), "{}\n");

      const importer = createCodexImporter();
      const discovery = await importer.discover({ roots: [dir] });

      expect(discovery.paths.map((path) => path.replace(dir, ""))).toEqual([
        "/.codex/archived_sessions/2026/05/25/archived.jsonl",
        "/.codex/sessions/2026/05/25/session.jsonl"
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("skips Codex sessions without importable messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-codex-empty-"));
    try {
      const path = join(dir, "session.jsonl");
      await writeFile(path, `${JSON.stringify({ type: "session_meta", sessionId: "empty-session" })}\n`);

      const importer = createCodexImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations).toEqual([]);
      expect(batch.diagnostics?.some((item) => item.code === "codex_no_messages")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("skips runtime context records that are not chat messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-codex-context-"));
    try {
      const path = join(dir, "session.jsonl");
      await writeFile(
        path,
        [
          { type: "session_meta", sessionId: "context-session" },
          { type: "context_snapshot", timestamp: "2026-05-21T12:00:00.000Z", payload: { text: "<permissions instructions>\nRuntime-only context." } },
          { type: "user", timestamp: "2026-05-21T12:01:00.000Z", payload: { text: "Back up my messages." } }
        ].map((item) => JSON.stringify(item)).join("\n")
      );

      const importer = createCodexImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations).toHaveLength(1);
      expect(batch.conversations[0]!.messages.map((message) => message.role)).toEqual(["user"]);
      expect(batch.conversations[0]!.messages.some((message) => message.text.includes("<permissions instructions>"))).toBe(false);
      expect(batch.diagnostics?.some((item) => item.code === "codex_events_unmapped")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uses the first real user request as the title instead of agent instructions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-codex-title-"));
    try {
      const path = join(dir, "session.jsonl");
      await writeFile(
        path,
        [
          { type: "session_meta", sessionId: "title-session" },
          {
            type: "user",
            timestamp: "2026-05-21T12:00:00.000Z",
            payload: { text: "# AGENTS.md instructions for /workspace/sanitized\n\nProject rules." }
          },
          {
            type: "user",
            timestamp: "2026-05-21T12:01:00.000Z",
            payload: { text: "{\"risk_level\":\"medium\",\"outcome\":\"allow\"}" }
          },
          {
            type: "user",
            timestamp: "2026-05-21T12:02:00.000Z",
            payload: { text: "<skill>\n<name>frontend-design</name>\n<path>/workspace/.codex/skills/frontend-design/SKILL.md</path>\n</skill>" }
          },
          {
            type: "user",
            timestamp: "2026-05-21T12:03:00.000Z",
            payload: { text: "Check whether today's imported messages are duplicated" }
          }
        ].map((item) => JSON.stringify(item)).join("\n")
      );

      const importer = createCodexImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations[0]!.title).toBe("Check whether today's imported messages are duplicated");
      expect(batch.conversations[0]!.messages).toHaveLength(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("leaves the title empty when every title candidate is boilerplate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-codex-title-fallback-"));
    try {
      const path = join(dir, "rollout-2026-05-08T03-23-18-019e071c-f36c-7401-ab21-9c927bb56377.jsonl");
      await writeFile(
        path,
        [
          {
            type: "user",
            timestamp: "2026-05-08T03:23:18.000Z",
            payload: { text: "<skill>\n<name>frontend-design</name>\n</skill>" }
          }
        ].map((item) => JSON.stringify(item)).join("\n")
      );

      const importer = createCodexImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations[0]!.title).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps review prompt titles but removes repository path prefixes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-codex-review-title-"));
    try {
      const path = join(dir, "session.jsonl");
      await writeFile(
        path,
        [
          {
            type: "user",
            timestamp: "2026-05-21T12:00:00.000Z",
            payload: {
              text: "Repository: /workspace/sanitized. Review PR #59 against origin/main and return actionable findings only."
            }
          }
        ].map((item) => JSON.stringify(item)).join("\n")
      );

      const importer = createCodexImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations[0]!.title).toBe("Review PR #59 against origin/main and return actionable findings only.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("prefers Codex history text for titles when available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-codex-history-title-"));
    try {
      const codexRoot = join(dir, ".codex");
      const sessionsRoot = join(codexRoot, "sessions");
      await mkdir(sessionsRoot, { recursive: true });
      const sessionId = "019e071c-f36c-7401-ab21-9c927bb56377";
      const path = join(sessionsRoot, `rollout-2026-05-08T03-23-18-${sessionId}.jsonl`);
      await writeFile(
        join(codexRoot, "history.jsonl"),
        `${JSON.stringify({ session_id: sessionId, ts: 1772873219, text: "Use the user input from history.jsonl directly as the title" })}\n`
      );
      await writeFile(
        path,
        [
          {
            type: "user",
            timestamp: "2026-05-08T03:23:18.000Z",
            payload: { text: "<skill>\n<name>frontend-design</name>\n</skill>" }
          },
          {
            type: "assistant",
            timestamp: "2026-05-08T03:24:18.000Z",
            payload: { message: { role: "assistant", content: "History title should win." } }
          }
        ].map((item) => JSON.stringify(item)).join("\n")
      );

      const importer = createCodexImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations[0]!.title).toBe("Use the user input from history.jsonl directly as the title");
      expect(batch.conversations[0]!.messages).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports absent default roots cleanly", async () => {
    const importer = createCodexImporter();
    const discovery = await importer.discover({ roots: [resolve(import.meta.dir, "missing-codex-root")] });

    expect(discovery.present).toBe(false);
    expect(discovery.paths).toEqual([]);
    expect(discovery.confidenceReason).toContain("Codex JSONL");
  });
});
