import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = resolve(repositoryRoot, "skills/recallbase");
export const singleFileSkillPath = resolve(repositoryRoot, "distributions/recallbase.skill.md");

const references = [
  { path: "references/mcp.md", anchor: "local-mcp" },
  { path: "references/results.md", anchor: "result-reference" },
  { path: "references/troubleshooting.md", anchor: "troubleshooting" },
] as const;

export function buildSingleFileSkill(): string {
  let skill = readFileSync(resolve(skillRoot, "SKILL.md"), "utf8").trimEnd();

  for (const reference of references) {
    skill = skill.replaceAll(`](${reference.path})`, `](#${reference.anchor})`);
  }

  const bundledReferences = references.map((reference) =>
    readFileSync(resolve(skillRoot, reference.path), "utf8").trim(),
  );

  return `${skill}\n\n---\n\n${bundledReferences.join("\n\n---\n\n")}\n`;
}

if (import.meta.main) {
  const expected = buildSingleFileSkill();
  const check = process.argv.includes("--check");

  if (check) {
    const actual = await Bun.file(singleFileSkillPath).text().catch(() => "");
    if (actual !== expected) {
      console.error("distributions/recallbase.skill.md is out of date; run bun run package:agent-skill");
      process.exit(1);
    }
    console.log("Agent Skill distribution is up to date.");
  } else {
    await Bun.write(singleFileSkillPath, expected);
    console.log("Wrote distributions/recallbase.skill.md");
  }
}
