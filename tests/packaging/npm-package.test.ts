import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageNpmRelease, parsePackageNpmOptions } from "../../scripts/package-npm";

describe("npm package artifacts", () => {
  test("creates a native shim package plus platform binary packages", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "recallbase-npm-"));
    const artifactsRoot = join(rootDir, ".artifacts", "npm");
    const rootReadme = "# RecallBase\n\nCanonical package documentation.\n";
    await writeFile(join(rootDir, "package.json"), JSON.stringify({ version: "0.1.0" }));
    await writeFile(join(rootDir, "README.md"), rootReadme);

    const commands: string[] = [];
    const output = await packageNpmRelease(parsePackageNpmOptions(["--targets=darwin-arm64,linux-x64"]), {
      rootDir,
      artifactsRoot,
      run: async (command) => {
        commands.push(command.join(" "));
        if (command[0] === "bun") {
          const outfile = command.find((part) => part.startsWith("--outfile="))?.slice("--outfile=".length);
          if (!outfile) throw new Error(`missing outfile: ${command.join(" ")}`);
          await writeFile(outfile, "native binary");
        }
        if (command[0] === "npm") await mkdir(join(artifactsRoot, "0.1.0", "tarballs"), { recursive: true });
      }
    });

    expect(commands.filter((command) => command.startsWith("bun run package:cli"))).toHaveLength(2);
    expect(commands.filter((command) => command.startsWith("npm pack"))).toHaveLength(3);

    const meta = JSON.parse(await readFile(join(output, "packages", "recallbase", "package.json"), "utf8"));
    expect(meta.bin).toEqual({ rb: "bin/recallbase.cjs", recallbase: "bin/recallbase.cjs" });
    expect(meta.engines).toEqual({ node: ">=18" });
    expect(meta.optionalDependencies).toEqual({
      "recallbase-darwin-arm64": "npm:recallbase@0.1.0-darwin-arm64",
      "recallbase-linux-x64": "npm:recallbase@0.1.0-linux-x64"
    });
    expect(meta.repository.url).toBe("git+https://github.com/DarinRowe/RecallBase.git");
    expect(meta).toMatchObject({
      version: "0.1.0",
      license: "MIT",
      author: "Darin Rowe",
      homepage: "https://recallbase.net/desktop-cli/",
      bugs: { url: "https://github.com/DarinRowe/RecallBase/issues" }
    });
    expect(meta.keywords).toEqual(
      expect.arrayContaining(["cli", "mcp-server", "local-first", "conversation-history"])
    );
    const readme = await readFile(join(output, "packages", "recallbase", "README.md"), "utf8");
    expect(readme).toBe(rootReadme);
    expect(await readFile(join(output, "packages", "recallbase", "bin", "recallbase.cjs"), "utf8")).toContain(
      "process.platform + \"-\" + process.arch"
    );

    const darwin = JSON.parse(await readFile(join(output, "packages", "recallbase-darwin-arm64", "package.json"), "utf8"));
    expect(darwin.name).toBe("recallbase");
    expect(darwin.version).toBe("0.1.0-darwin-arm64");
    expect(darwin.os).toEqual(["darwin"]);
    expect(darwin.cpu).toEqual(["arm64"]);
    expect(darwin.libc).toBeUndefined();
    expect(darwin.repository.url).toBe("git+https://github.com/DarinRowe/RecallBase.git");
    expect(darwin.homepage).toBe("https://recallbase.net/desktop-cli/");
    expect(darwin.license).toBe("MIT");
    expect(await readFile(join(output, "packages", "recallbase-darwin-arm64", "README.md"), "utf8")).toBe(
      rootReadme
    );

    const linux = JSON.parse(await readFile(join(output, "packages", "recallbase-linux-x64", "package.json"), "utf8"));
    expect(linux.libc).toEqual(["glibc"]);
  });
});
