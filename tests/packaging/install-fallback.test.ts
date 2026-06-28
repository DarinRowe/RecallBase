import { describe, expect, test } from "bun:test";

describe("package-manager install fallback", () => {
  test("source CLI entrypoint can run when compiled binary is unsupported", async () => {
    const run = Bun.spawn(["bun", "apps/cli/src/cli.ts", "--help"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe"
    });

    expect(await run.exited).toBe(0);
    expect(await new Response(run.stdout).text()).toContain("RecallBase commands");
  });
});
