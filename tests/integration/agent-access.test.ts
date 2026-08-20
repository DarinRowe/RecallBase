import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../../apps/cli/src/cli";
import { buildSingleFileSkill, singleFileSkillPath } from "../../scripts/package-agent-skill";

describe("Agent access", () => {
  test("the Claude plugin exposes the canonical skill at the package version", () => {
    const plugin = JSON.parse(readFileSync(resolve(".claude-plugin/plugin.json"), "utf8"));
    const packageMetadata = JSON.parse(readFileSync(resolve("package.json"), "utf8"));

    expect(plugin.name).toBe("recallbase");
    expect(plugin.version).toBe(packageMetadata.version);
    expect(plugin.skills).toBe("./skills/");
    expect(existsSync(resolve("skills/recallbase/SKILL.md"))).toBe(true);
  });

  test("Gemini and single-file registries receive current Skill instructions", () => {
    const gemini = JSON.parse(readFileSync(resolve("gemini-extension.json"), "utf8"));
    const packageMetadata = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    const distribution = readFileSync(singleFileSkillPath, "utf8");

    expect(gemini.name).toBe("recallbase");
    expect(gemini.version).toBe(packageMetadata.version);
    expect(distribution).toBe(buildSingleFileSkill());
    expect(distribution).toContain("# Local MCP");
    expect(distribution).toContain("# Result reference");
    expect(distribution).toContain("# Troubleshooting");
    expect(distribution).not.toContain("](references/");
  });

  test("an Agent can follow the skill and recover continuation context through CLI JSON", async () => {
    const skill = readFileSync(resolve("skills/recallbase/SKILL.md"), "utf8");
    const agents = readFileSync(resolve("AGENTS.md"), "utf8");
    const dir = mkdtempSync(join(tmpdir(), "rb-agent-flow-"));
    const dbPath = join(dir, "recallbase.sqlite");
    const fixturesRoot = resolve("tests/fixtures/importers");

    await runCommand(["import", "--json", "--db", dbPath, "--root", fixturesRoot]);
    const sources = JSON.parse((await runCommand(["sources", "--json", "--db", dbPath])).stdout);
    const today = JSON.parse((await runCommand(["today", "--json", "--db", dbPath, "--date", "2026-05-21"])).stdout);
    const search = JSON.parse((await runCommand(["search", "fixture coverage", "--json", "--db", dbPath])).stdout);
    const opened = JSON.parse((await runCommand(["open", search.data.results[0].id, "--json", "--db", dbPath])).stdout);

    const skillRoot = resolve("skills/recallbase");
    const skillPath = resolve(skillRoot, "SKILL.md");
    const linkedFiles = [...skill.matchAll(/\]\(([^)]+\.md)\)/g)]
      .map((match) => resolve(dirname(skillPath), match[1]!));

    expect(skill).toContain("rb today --json");
    expect(skill).toContain("rb search \"<specific query>\" --json");
    expect(skill).toContain("rb open <conversation-id> --json");
    expect(linkedFiles.length).toBeGreaterThan(0);
    expect(linkedFiles.every(existsSync)).toBe(true);
    expect(existsSync(resolve(skillRoot, "agents/openai.yaml"))).toBe(true);
    expect(agents).toContain("update `skills/recallbase/SKILL.md`");
    expect(sources.data.sources.some((source: { health: string }) => source.health === "healthy" || source.health === "partial")).toBe(true);
    expect(today.data.continuationHints[0]).toStartWith("rb open ");
    expect(search.data.results[0].sourceId).toBe("claude-code");
    expect(JSON.stringify(opened.data)).toContain("Importer tests cover diagnostics and raw evidence");
  });
});
