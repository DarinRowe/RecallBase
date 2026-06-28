import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDatabase } from "@recallbase/core";
import { createCopilotImporter } from "../src/copilot/importer";

const fixtureRoot = resolve(import.meta.dir, "../../../tests/fixtures/importers/copilot");

describe("Copilot importer", () => {
  test("imports VS Code chatSessions JSON with experimental confidence", async () => {
    const importer = createCopilotImporter();
    const discovery = await importer.discover({ roots: [fixtureRoot] });
    const batch = await importer.importFromPaths(discovery.paths, { discovery });

    expect(discovery.present).toBe(true);
    expect(batch.confidence).toBe("experimental");
    expect(batch.diagnostics?.some((item) => item.code === "copilot_experimental")).toBe(true);
    expect(batch.diagnostics?.some((item) => item.code === "copilot_response_unmapped")).toBe(true);

    expect(batch.conversations.map((item) => item.upstreamId)).toContain("copilot-session-1");
    expect(batch.conversations.map((item) => item.upstreamId)).toContain("copilot-session-jsonl-1");

    const conversation = batch.conversations.find((item) => item.upstreamId === "copilot-session-1")!;
    expect(conversation.title).toBe("RecallBase importer check");
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(conversation.rawEvidence).toEqual([]);
    expect(conversation.messages.some((message) => message.rawEvidenceUri)).toBe(false);

    const jsonlConversation = batch.conversations.find((item) => item.upstreamId === "copilot-session-jsonl-1")!;
    expect(jsonlConversation.title).toBe("RecallBase JSONL importer check");
    expect(jsonlConversation.messages.map((message) => message.role)).toEqual(["user", "assistant"]);

    const db = new LocalDatabase();
    db.importBatch(batch);
    expect(db.sources()[0]).toMatchObject({ id: "copilot", confidence: "experimental", health: "healthy" });
    expect(db.search("read-only adapters")[0]).toMatchObject({ sourceId: "copilot" });
  });

  test("skips Copilot sessions without importable messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-copilot-empty-"));
    try {
      const path = join(dir, "empty.json");
      await writeFile(path, JSON.stringify({ sessionId: "empty-session", requests: [] }));

      const importer = createCopilotImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations).toEqual([]);
      expect(batch.diagnostics?.some((item) => item.code === "copilot_no_messages")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("deduplicates repeated Copilot request messages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-copilot-duplicate-"));
    try {
      const path = join(dir, "duplicate.json");
      const request = {
        requestId: "request-1",
        timestamp: "2026-05-21T12:00:00.000Z",
        message: "Do not import Copilot prompt twice.",
        response: "Do not import Copilot response twice."
      };
      await writeFile(path, JSON.stringify({ sessionId: "duplicate-session", requests: [request, request] }));

      const importer = createCopilotImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations).toHaveLength(1);
      expect(batch.conversations[0]!.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(batch.conversations[0]!.messages).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("prefers Copilot customTitle for conversation title", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-copilot-custom-title-"));
    try {
      const path = join(dir, "custom-title.json");
      await writeFile(
        path,
        JSON.stringify({
          sessionId: "custom-title-session",
          customTitle: "Fix import title handling",
          requests: [
            {
              requestId: "request-1",
              timestamp: "2026-05-21T12:00:00.000Z",
              message: "# AGENTS.md instructions for /tmp/project\n\nRules.",
              response: "Use the stored title."
            }
          ]
        })
      );

      const importer = createCopilotImporter();
      const batch = await importer.importFromPaths([path]);

      expect(batch.conversations[0]!.title).toBe("Fix import title handling");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
