const NONE_MARKER = /^Release-Note: none - \S.*$/m;

export type ReleaseNoteDecision = "changelog" | "none";

export function validateReleaseNote(changedFiles: string[], pullRequestBody: string): ReleaseNoteDecision {
  if (changedFiles.includes("CHANGELOG.md")) return "changelog";
  if (NONE_MARKER.test(pullRequestBody)) return "none";

  throw new Error(
    "Every pull request must update CHANGELOG.md under [Unreleased] or include "
      + "'Release-Note: none - <reason>' in the pull request body."
  );
}

function changedFiles(base: string): string[] {
  return [...new Set([
    ...gitDiff(["--name-only", `${base}...HEAD`], base),
    ...gitDiff(["--name-only"], base),
    ...gitDiff(["--cached", "--name-only"], base)
  ])];
}

function gitDiff(args: string[], base: string): string[] {
  const result = Bun.spawnSync(["git", "diff", ...args], {
    stdout: "pipe",
    stderr: "pipe"
  });
  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr).trim() || `Could not compare against ${base}.`);
  }
  return new TextDecoder().decode(result.stdout).split("\n").filter(Boolean);
}

function main(): void {
  const base = process.env.RELEASE_NOTE_BASE_REF ?? "origin/main";
  const decision = validateReleaseNote(changedFiles(base), process.env.RELEASE_NOTE_PR_BODY ?? "");
  console.log(decision === "changelog" ? "CHANGELOG.md updated." : "Release-Note: none accepted.");
}

if (import.meta.main) main();
