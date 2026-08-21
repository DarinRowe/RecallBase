export type ReleaseChannel = "stable" | "test";

type ReleaseNotesInput = {
  version: string;
  channel: ReleaseChannel;
  changelog?: string;
};

export function renderReleaseNotes({ version, channel, changelog }: ReleaseNotesInput): string {
  const changes = channel === "stable" ? stableChanges(version, changelog) : undefined;
  const introduction = changes
    ? "## What's changed\n\n" + changes
    : "Test release for CLI dogfooding.";

  return [
    "# RecallBase " + version,
    "",
    introduction,
    "",
    "## Install CLI",
    "",
    "```bash",
    "npm install -g recallbase",
    "# Linux alternative pinned to this release:",
    "curl -fsSL https://github.com/DarinRowe/RecallBase/releases/download/" + version + "/install-linux.sh | env RB_VERSION=" + version + " bash",
    "# Or download the platform tarball from this release and put rb on PATH.",
    "```",
    "",
    "## Artifacts",
    "",
    "- Bun-compiled CLI tarball(s)",
    "- Linux installer with SHA-256 verification",
    "- SHA-256 checksum manifest",
    "",
    "## Native host setup",
    "",
    "```bash",
    "rb extension install-host",
    "rb extension verify-host",
    "```",
    ""
  ].join("\n");
}

function stableChanges(version: string, changelog?: string): string {
  const changelogVersion = version.replace(/^v/, "");
  if (!changelog) {
    throw new Error("Stable release " + version + " requires CHANGELOG.md");
  }

  const escapedVersion = changelogVersion.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const heading = new RegExp("^## \\[" + escapedVersion + "\\](?:\\s+-\\s+.+)?\\s*$", "m");
  const match = heading.exec(changelog);
  if (!match) {
    throw new Error("CHANGELOG.md is missing a ## [" + changelogVersion + "] release entry");
  }

  const afterHeading = changelog.slice(match.index + match[0].length);
  const nextHeading = afterHeading.search(/^##\s+/m);
  const changes = afterHeading.slice(0, nextHeading === -1 ? undefined : nextHeading).trim();
  if (!changes) {
    throw new Error("CHANGELOG.md release entry ## [" + changelogVersion + "] is empty");
  }
  return changes;
}
