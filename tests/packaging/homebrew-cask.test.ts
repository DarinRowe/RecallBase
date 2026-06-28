import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageHomebrewCask } from "../../scripts/package-homebrew";

describe("Homebrew cask packaging", () => {
  test("generates a cask from macOS release artifacts", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "recallbase-homebrew-"));
    const releaseDir = join(rootDir, ".artifacts", "release", "v0.1.0");
    await mkdir(releaseDir, { recursive: true });
    await writeFile(join(rootDir, "package.json"), JSON.stringify({ version: "0.1.0" }));
    await writeFile(
      join(releaseDir, "manifest.json"),
      JSON.stringify({
        version: "v0.1.0",
        artifacts: [
          { name: "recallbase-aarch64-apple-darwin-v0.1.0.tar.gz", sha256: "arm-sha" },
          { name: "recallbase-x86_64-apple-darwin-v0.1.0.tar.gz", sha256: "intel-sha" }
        ]
      })
    );

    const output = await packageHomebrewCask({ repo: "DarinRowe/RecallBase" }, rootDir);
    const cask = await readFile(output, "utf8");

    expect(cask).toContain('cask "recallbase"');
    expect(cask).toContain('version "0.1.0"');
    expect(cask).toContain('sha256 "arm-sha"');
    expect(cask).toContain('sha256 "intel-sha"');
    expect(cask).toContain("https://github.com/DarinRowe/RecallBase/releases/download/v0.1.0/recallbase-aarch64-apple-darwin-v0.1.0.tar.gz");
    expect(cask).toContain('binary "rb", target: "recallbase"');
  });
});
