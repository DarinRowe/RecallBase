import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CLI packaging smoke", () => {
  test("package script produces a CLI binary that starts", async () => {
    const packageRun = Bun.spawn(["bun", "run", "scripts/package-cli.ts"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe"
    });
    const packageExit = await packageRun.exited;
    const binaryPath = (await new Response(packageRun.stdout).text()).trim().split("\n").at(-1) ?? "";

    expect(packageExit).toBe(0);
    expect(existsSync(binaryPath)).toBe(true);

    const helpRun = Bun.spawn([binaryPath, "--help"], { stdout: "pipe", stderr: "pipe" });
    expect(await helpRun.exited).toBe(0);
    expect(await new Response(helpRun.stdout).text()).toContain("RecallBase commands");
  });

  test("package script creates the explicit outfile parent directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "recallbase-cli-outfile-"));
    const outfile = join(root, "nested", "bin", process.platform === "win32" ? "rb.exe" : "rb");
    const packageRun = Bun.spawn(["bun", "run", "scripts/package-cli.ts", `--outfile=${outfile}`], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe"
    });

    expect(await packageRun.exited).toBe(0);
    expect(existsSync(outfile)).toBe(true);
  });
});
