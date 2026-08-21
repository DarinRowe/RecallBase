import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type PrepareReleaseOptions = {
  rootDir: string;
  version: string;
  date: string;
};

const versionJsonFiles = [
  "package.json",
  "apps/cli/package.json",
  ".claude-plugin/plugin.json",
  "gemini-extension.json"
];

export async function prepareRelease(options: PrepareReleaseOptions): Promise<void> {
  const nextVersion = normalizeVersion(options.version);
  const packagePath = join(options.rootDir, "package.json");
  const packageText = await readFile(packagePath, "utf8");
  const currentVersion = readJsonVersion(packageText, "package.json");
  assertNewerVersion(currentVersion, nextVersion);

  const changelogPath = join(options.rootDir, "CHANGELOG.md");
  const lockPath = join(options.rootDir, "bun.lock");
  const changelog = prepareChangelog(
    await readFile(changelogPath, "utf8"),
    currentVersion,
    nextVersion,
    options.date
  );
  const lock = updateCliWorkspaceVersion(await readFile(lockPath, "utf8"), currentVersion, nextVersion);
  const jsonUpdates = await Promise.all(versionJsonFiles.map(async (path) => {
    const absolutePath = join(options.rootDir, path);
    const content = path === "package.json" ? packageText : await readFile(absolutePath, "utf8");
    return { absolutePath, content: updateJsonVersion(content, currentVersion, nextVersion, path) };
  }));

  await Promise.all([
    writeFile(changelogPath, changelog),
    writeFile(lockPath, lock),
    ...jsonUpdates.map(({ absolutePath, content }) => writeFile(absolutePath, content))
  ]);
}

export function prepareChangelog(
  changelog: string,
  currentVersion: string,
  nextVersion: string,
  date: string
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid release date '${date}'. Expected YYYY-MM-DD.`);
  if (new RegExp(`^## \\[${escapeRegExp(nextVersion)}\\]`, "m").test(changelog)) {
    throw new Error(`CHANGELOG.md already contains version ${nextVersion}.`);
  }

  const unreleased = /^## \[Unreleased\][ \t]*$/m.exec(changelog);
  if (!unreleased) throw new Error("CHANGELOG.md is missing ## [Unreleased].");
  const afterHeadingIndex = unreleased.index + unreleased[0].length;
  const afterHeading = changelog.slice(afterHeadingIndex);
  const nextHeadingOffset = afterHeading.search(/^##\s+/m);
  if (nextHeadingOffset < 0) throw new Error("CHANGELOG.md has no released version after ## [Unreleased].");
  const changes = afterHeading.slice(0, nextHeadingOffset).trim();
  if (!changes) throw new Error("CHANGELOG.md ## [Unreleased] is empty.");

  const released = afterHeading.slice(nextHeadingOffset);
  const currentHeading = new RegExp(`^## \\[${escapeRegExp(currentVersion)}\\](?:\\s+-\\s+.+)?[ \\t]*$`, "m");
  if (!currentHeading.test(released)) {
    throw new Error(`CHANGELOG.md does not contain current package version ${currentVersion} after [Unreleased].`);
  }

  const unreleasedLink = new RegExp(
    `^\\[Unreleased\\]: https://github\\.com/DarinRowe/RecallBase/compare/v${escapeRegExp(currentVersion)}\\.\\.\\.HEAD$`,
    "m"
  );
  if (!unreleasedLink.test(changelog)) {
    throw new Error(`CHANGELOG.md [Unreleased] link does not start at v${currentVersion}.`);
  }

  const body = `${changelog.slice(0, afterHeadingIndex)}\n\n## [${nextVersion}] - ${date}\n\n${changes}\n\n${released.trimStart()}`;
  return body.replace(
    unreleasedLink,
    `[Unreleased]: https://github.com/DarinRowe/RecallBase/compare/v${nextVersion}...HEAD\n`
      + `[${nextVersion}]: https://github.com/DarinRowe/RecallBase/compare/v${currentVersion}...v${nextVersion}`
  );
}

function updateJsonVersion(content: string, currentVersion: string, nextVersion: string, path: string): string {
  const parsed = JSON.parse(content) as { version?: unknown };
  if (parsed.version !== currentVersion) {
    throw new Error(`${path} version must be ${currentVersion}, found ${String(parsed.version)}.`);
  }
  parsed.version = nextVersion;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function updateCliWorkspaceVersion(content: string, currentVersion: string, nextVersion: string): string {
  const pattern = /(\"apps\/cli\":\s*\{[\s\S]*?\"version\":\s*\")([^\"]+)(\")/;
  const match = pattern.exec(content);
  if (!match || match[2] !== currentVersion) {
    throw new Error(`bun.lock apps/cli version must be ${currentVersion}.`);
  }
  return content.replace(pattern, `$1${nextVersion}$3`);
}

function readJsonVersion(content: string, path: string): string {
  const version = (JSON.parse(content) as { version?: unknown }).version;
  if (typeof version !== "string") throw new Error(`${path} has no string version.`);
  return normalizeVersion(version);
}

function normalizeVersion(version: string): string {
  const normalized = version.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) throw new Error(`Invalid release version '${version}'.`);
  return normalized;
}

function assertNewerVersion(currentVersion: string, nextVersion: string): void {
  const current = currentVersion.split(".").map(Number);
  const next = nextVersion.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (next[index]! > current[index]!) return;
    if (next[index]! < current[index]!) break;
  }
  throw new Error(`Release version ${nextVersion} must be newer than ${currentVersion}.`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseOptions(args: string[]): Omit<PrepareReleaseOptions, "rootDir"> {
  let version: string | undefined;
  let date = new Date().toISOString().slice(0, 10);
  for (const arg of args) {
    if (arg.startsWith("--version=")) version = arg.slice("--version=".length);
    else if (arg.startsWith("--date=")) date = arg.slice("--date=".length);
    else throw new Error(`Unknown prepare-release option: ${arg}`);
  }
  if (!version) throw new Error("prepare-release requires --version=<semver>.");
  return { version, date };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await prepareRelease({ rootDir: process.cwd(), ...options });
  console.log(`Prepared RecallBase ${normalizeVersion(options.version)}.`);
}

if (import.meta.main) await main();
