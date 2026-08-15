import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  packageRelease,
  parsePackageReleaseOptions,
  releaseArtifactNames,
  releaseVersion
} from "../../scripts/package-release";

describe("release packaging metadata", () => {
  test("defaults to the package version for stable release artifacts", () => {
    expect(releaseVersion("0.1.0", parsePackageReleaseOptions([]))).toBe("v0.1.0");
  });

  test("creates timestamped test release versions", () => {
    const version = releaseVersion("0.1.0", parsePackageReleaseOptions(["--test"]), new Date("2026-05-22T09:07:00-07:00"));

    expect(version).toBe("v0.1.0-test.202605221607");
  });

  test("uses explicit artifact names for CLI packages", () => {
    expect(releaseArtifactNames("v0.1.0-test.1")).toMatchObject({
      cli: expect.stringMatching(/^recallbase-.+-v0\.1\.0-test\.1\.tar\.gz$/)
    });
  });

  test("packages CLI tarball, checksums, manifest, and release notes", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "recallbase-release-"));
    const artifactsRoot = join(rootDir, ".artifacts", "release");
    await writeFile(join(rootDir, "package.json"), JSON.stringify({ version: "0.1.0" }));
    await mkdir(join(rootDir, "scripts"));
    await writeFile(join(rootDir, "scripts", "install-linux.sh"), "#!/usr/bin/env bash\necho install\n");

    const commands: string[] = [];
    const releaseDir = await packageRelease(parsePackageReleaseOptions(["--test"]), {
      rootDir,
      artifactsRoot,
      now: new Date("2026-05-22T09:07:00-07:00"),
      run: async (command) => {
        commands.push(command.join(" "));
        const outdir = command.find((part) => part.startsWith("--outdir="))?.slice("--outdir=".length);
        const outfile = command.find((part) => part.startsWith("--outfile="))?.slice("--outfile=".length);
        if (!outdir || !outfile) throw new Error(`missing CLI output options: ${command.join(" ")}`);
        await mkdir(outdir, { recursive: true });
        await writeFile(outfile, "cli binary");
      }
    });

    expect(commands).toEqual([expect.stringContaining("bun run package:cli -- --target=")]);
    const releaseEntries = (await readdir(releaseDir)).sort();
    const cliName = releaseEntries.find((entry) => entry.startsWith("recallbase-") && entry.endsWith(".tar.gz"));
    if (!cliName) throw new Error("expected CLI tarball in release output");
    expect(releaseEntries).toEqual([
      "checksums.sha256",
      "install-linux.sh",
      "manifest.json",
      cliName,
      "release-notes.md"
    ].sort());

    const manifest = JSON.parse(await readFile(join(releaseDir, "manifest.json"), "utf8"));
    const cliArchive = readSingleFileTarGz(await readFile(join(releaseDir, cliName)));

    expect(manifest.artifacts).toEqual([
      expect.objectContaining({ name: cliName, size: expect.any(Number), sha256: expect.any(String) })
    ]);
    expect(cliArchive).toEqual({ name: "rb", mtime: 0, payload: "cli binary" });
    const checksums = await readFile(join(releaseDir, "checksums.sha256"), "utf8");
    expect(checksums).toContain(`  ${cliName}\n`);
    expect(await readFile(join(releaseDir, "release-notes.md"), "utf8")).toContain("rb extension install-host");
    expect(await readFile(join(releaseDir, "install-linux.sh"), "utf8")).toContain("echo install");
  });
});

function readSingleFileTarGz(archive: Buffer): { name: string; mtime: number; payload: string } {
  const tar = gunzipSync(archive);
  const name = tar.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
  const size = parseInt(tar.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
  const mtime = parseInt(tar.subarray(136, 148).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
  const payload = tar.subarray(512, 512 + size).toString("utf8");
  const secondHeader = tar.subarray(512 + Math.ceil(size / 512) * 512, 512 + Math.ceil(size / 512) * 512 + 512);

  expect(secondHeader.every((byte) => byte === 0)).toBe(true);
  return { name, mtime, payload };
}
