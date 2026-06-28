import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

type ReleaseChannel = "stable" | "test";

export type PackageReleaseOptions = {
  channel: ReleaseChannel;
  version?: string;
  cliTargets: CliTarget[];
};

export type CliTarget = "host" | "all" | TargetId;

export type TargetId =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "win32-x64";

export type CliTargetInfo = {
  id: TargetId;
  bunTarget: string;
  releaseTarget: string;
  binaryName: string;
};

type PackageReleasePaths = {
  rootDir: string;
  artifactsRoot: string;
};

type PackageReleaseRuntime = PackageReleasePaths & {
  now?: Date;
  run?: (command: string[], cwd: string) => void | Promise<void>;
};

const defaultPaths: PackageReleasePaths = {
  rootDir: process.cwd(),
  artifactsRoot: join(process.cwd(), ".artifacts", "release")
};

const allCliTargets: CliTargetInfo[] = [
  { id: "darwin-arm64", bunTarget: "bun-darwin-arm64", releaseTarget: "aarch64-apple-darwin", binaryName: "rb" },
  { id: "darwin-x64", bunTarget: "bun-darwin-x64", releaseTarget: "x86_64-apple-darwin", binaryName: "rb" },
  { id: "linux-arm64", bunTarget: "bun-linux-arm64", releaseTarget: "aarch64-unknown-linux-gnu", binaryName: "rb" },
  { id: "linux-x64", bunTarget: "bun-linux-x64", releaseTarget: "x86_64-unknown-linux-gnu", binaryName: "rb" },
  { id: "win32-x64", bunTarget: "bun-windows-x64", releaseTarget: "x86_64-pc-windows-msvc", binaryName: "rb.exe" }
];

export function parsePackageReleaseOptions(args: string[]): PackageReleaseOptions {
  const options: PackageReleaseOptions = { channel: "stable", cliTargets: ["host"] };
  for (const arg of args) {
    if (arg === "--test" || arg === "--channel=test") options.channel = "test";
    else if (arg === "--channel=stable") options.channel = "stable";
    else if (arg.startsWith("--version=")) options.version = arg.slice("--version=".length);
    else if (arg.startsWith("--cli-targets=")) options.cliTargets = parseCliTargets(arg.slice("--cli-targets=".length));
    else throw new Error(`Unknown package-release option: ${arg}`);
  }
  return options;
}

export function releaseVersion(packageVersion: string, options: PackageReleaseOptions, now = new Date()): string {
  if (options.version) return options.version;
  if (options.channel === "stable") return `v${packageVersion}`;
  return `v${packageVersion}-test.${timestamp(now)}`;
}

export function releaseArtifactNames(version: string) {
  return {
    cli: `recallbase-${hostCliTarget().releaseTarget}-${version}.tar.gz`
  };
}

export function cliArtifactName(target: CliTargetInfo, version: string): string {
  return `recallbase-${target.releaseTarget}-${version}.tar.gz`;
}

async function main(): Promise<void> {
  const options = parsePackageReleaseOptions(process.argv.slice(2));
  const releaseDir = await packageRelease(options, defaultPaths);
  console.log(releaseDir);
}

export async function packageRelease(
  options: PackageReleaseOptions,
  runtime: PackageReleaseRuntime = defaultPaths
): Promise<string> {
  const rootDir = runtime.rootDir;
  const artifactsRoot = runtime.artifactsRoot;
  const runCommand = runtime.run ?? run;
  const packageJson = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8")) as { version: string };
  const version = releaseVersion(packageJson.version, options, runtime.now);
  const releaseDir = join(artifactsRoot, version);
  const cliBuildDir = join(artifactsRoot, `${version}.cli`);
  const cliTargets = resolveCliTargets(options.cliTargets);

  await rm(releaseDir, { recursive: true, force: true });
  await rm(cliBuildDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  try {
    const checksums: string[] = [];
    const manifest = [];

    for (const target of cliTargets) {
      const targetBuildDir = join(cliBuildDir, target.id);
      const cliBinaryPath = join(targetBuildDir, target.binaryName);
      await runCommand(
        [
          "bun",
          "run",
          "package:cli",
          "--",
          `--target=${target.bunTarget}`,
          `--outdir=${targetBuildDir}`,
          `--outfile=${cliBinaryPath}`
        ],
        rootDir
      );
      const cliName = cliArtifactName(target, version);
      const cliArchivePath = join(releaseDir, cliName);
      await writeTarGz(cliBinaryPath, cliArchivePath, target.binaryName);
      const cliChecksum = await sha256(cliArchivePath);
      const cliSize = (await stat(cliArchivePath)).size;
      checksums.push(`${cliChecksum}  ${cliName}`);
      manifest.push({ name: cliName, size: cliSize, sha256: cliChecksum });
    }

    await writeFile(join(releaseDir, "checksums.sha256"), `${checksums.join("\n")}\n`);
    await writeFile(
      join(releaseDir, "manifest.json"),
      `${JSON.stringify({ version, channel: options.channel, artifacts: manifest }, null, 2)}\n`
    );
    await writeFile(join(releaseDir, "release-notes.md"), releaseNotes(version, options.channel));
  } finally {
    await rm(cliBuildDir, { recursive: true, force: true });
  }

  return releaseDir;
}

function run(command: string[], cwd: string): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (!result.success) {
    throw new Error(`Command failed: ${command.join(" ")}`);
  }
}

async function sha256(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

function releaseNotes(version: string, channel: ReleaseChannel): string {
  const qualifier = channel === "test" ? "Test release for CLI dogfooding." : "Release artifacts.";
  return `# RecallBase ${version}\n\n${qualifier}\n\nInstall CLI:\n\n\`\`\`bash\nnpm install -g recallbase\n# or download the platform tarball from this release and put rb on PATH\n\`\`\`\n\nArtifacts:\n\n- Bun-compiled CLI tarball(s)\n- SHA-256 checksum manifest\n\nNative host setup for the browser extension:\n\n\`\`\`bash\nrb extension install-host\nrb extension verify-host\n\`\`\`\n`;
}

export function resolveCliTargets(targets: CliTarget[]): CliTargetInfo[] {
  const expanded = targets.flatMap((target) => {
    if (target === "host") return [hostCliTarget()];
    if (target === "all") return allCliTargets;
    return [targetInfo(target)];
  });
  return Array.from(new Map(expanded.map((target) => [target.id, target])).values());
}

function hostCliTarget(): CliTargetInfo {
  if (process.platform === "darwin" && process.arch === "arm64") return targetInfo("darwin-arm64");
  if (process.platform === "darwin" && process.arch === "x64") return targetInfo("darwin-x64");
  if (process.platform === "linux" && process.arch === "arm64") return targetInfo("linux-arm64");
  if (process.platform === "linux" && process.arch === "x64") return targetInfo("linux-x64");
  if (process.platform === "win32" && process.arch === "x64") return targetInfo("win32-x64");
  throw new Error(`Unsupported host CLI target: ${process.platform}-${process.arch}`);
}

function targetInfo(id: TargetId): CliTargetInfo {
  const target = allCliTargets.find((candidate) => candidate.id === id);
  if (!target) throw new Error(`Unsupported CLI target: ${id}`);
  return target;
}

function parseCliTargets(value: string): CliTarget[] {
  return value.split(",").map((target) => {
    const trimmed = target.trim();
    if (trimmed === "host" || trimmed === "all" || allCliTargets.some((candidate) => candidate.id === trimmed)) {
      return trimmed as CliTarget;
    }
    throw new Error(`Unsupported CLI target: ${trimmed}`);
  });
}

async function writeTarGz(sourcePath: string, destination: string, entryName: string): Promise<void> {
  const size = (await stat(sourcePath)).size;
  const padding = Buffer.alloc((512 - (size % 512)) % 512);
  const gzip = createGzip();
  const output = createWriteStream(destination);
  const input = createReadStream(sourcePath);

  gzip.pipe(output);
  gzip.write(tarHeader(entryName, size));

  await new Promise<void>((resolve, reject) => {
    input.on("error", reject);
    gzip.on("error", reject);
    output.on("error", reject);
    input.on("end", () => {
      gzip.write(padding);
      gzip.end(Buffer.alloc(1024));
      resolve();
    });
    input.pipe(gzip, { end: false });
  });
  await finished(output);
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  writeOctal(header, 100, 8, 0o755);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar", 257, 5, "ascii");
  header.write("00", 263, 2, "ascii");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  buffer.write(text, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function timestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
}

if (import.meta.main) {
  await main();
}
