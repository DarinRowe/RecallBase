import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateReleaseNote } from "../../scripts/check-release-note";
import { prepareChangelog, prepareRelease } from "../../scripts/prepare-release";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("release-note policy", () => {
  test("requires either an Unreleased changelog edit or an explicit no-note reason", () => {
    expect(validateReleaseNote(["CHANGELOG.md", "src/feature.ts"], "")).toBe("changelog");
    expect(validateReleaseNote(["src/internal.ts"], "Release-Note: none - Internal refactor only.")).toBe("none");
    expect(() => validateReleaseNote(["src/feature.ts"], "")).toThrow("Every pull request must update CHANGELOG.md");
    expect(() => validateReleaseNote(["src/feature.ts"], "Release-Note: none")).toThrow("<reason>");
  });
});

describe("release preparation", () => {
  test("moves Unreleased changes into one version and updates all release metadata", async () => {
    const rootDir = await fixtureRoot();

    await prepareRelease({ rootDir, version: "v0.1.9", date: "2026-08-22" });

    const changelog = await readFile(join(rootDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("## [Unreleased]\n\n## [0.1.9] - 2026-08-22\n\n### Added\n\n- Added a feature.");
    expect(changelog).toContain("[Unreleased]: https://github.com/DarinRowe/RecallBase/compare/v0.1.9...HEAD");
    expect(changelog).toContain("[0.1.9]: https://github.com/DarinRowe/RecallBase/compare/v0.1.8...v0.1.9");
    for (const path of ["package.json", "apps/cli/package.json", ".claude-plugin/plugin.json", "gemini-extension.json"]) {
      expect(JSON.parse(await readFile(join(rootDir, path), "utf8")).version).toBe("0.1.9");
    }
    expect(await readFile(join(rootDir, "bun.lock"), "utf8")).toContain('"version": "0.1.9"');
  });

  test("rejects an empty Unreleased section before changing files", async () => {
    const changelog = fixtureChangelog().replace("### Added\n\n- Added a feature.\n\n", "");
    expect(() => prepareChangelog(changelog, "0.1.8", "0.1.9", "2026-08-22"))
      .toThrow("## [Unreleased] is empty");
  });
});

async function fixtureRoot(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), "recallbase-release-process-"));
  tempDirs.push(rootDir);
  await mkdir(join(rootDir, "apps/cli"), { recursive: true });
  await mkdir(join(rootDir, ".claude-plugin"), { recursive: true });
  for (const path of ["package.json", "apps/cli/package.json", ".claude-plugin/plugin.json", "gemini-extension.json"]) {
    await writeFile(join(rootDir, path), `${JSON.stringify({ name: "recallbase", version: "0.1.8" }, null, 2)}\n`);
  }
  await writeFile(join(rootDir, "bun.lock"), `{
  "workspaces": {
    "apps/cli": {
      "name": "recallbase",
      "version": "0.1.8",
    },
  },
}\n`);
  await writeFile(join(rootDir, "CHANGELOG.md"), fixtureChangelog());
  return rootDir;
}

function fixtureChangelog(): string {
  return `# Changelog

## [Unreleased]

### Added

- Added a feature.

## [0.1.8] - 2026-08-21

### Added

- Previous feature.

[Unreleased]: https://github.com/DarinRowe/RecallBase/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/DarinRowe/RecallBase/compare/v0.1.7...v0.1.8
`;
}
