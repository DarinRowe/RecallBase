import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CliTarget, resolveCliTargets } from "./package-release";

type PackageNpmOptions = {
  version?: string;
  targets: CliTarget[];
};

type PackageNpmRuntime = {
  rootDir: string;
  artifactsRoot: string;
  run?: (command: string[], cwd: string) => void | Promise<void>;
};

const defaultRuntime: PackageNpmRuntime = {
  rootDir: process.cwd(),
  artifactsRoot: join(process.cwd(), ".artifacts", "npm")
};

export function parsePackageNpmOptions(args: string[]): PackageNpmOptions {
  const options: PackageNpmOptions = { targets: ["host"] };
  for (const arg of args) {
    if (arg.startsWith("--version=")) options.version = arg.slice("--version=".length);
    else if (arg.startsWith("--targets=")) options.targets = parseTargets(arg.slice("--targets=".length));
    else throw new Error(`Unknown package-npm option: ${arg}`);
  }
  return options;
}

export async function packageNpmRelease(
  options: PackageNpmOptions,
  runtime: PackageNpmRuntime = defaultRuntime
): Promise<string> {
  const runCommand = runtime.run ?? run;
  const packageJson = JSON.parse(await readFile(join(runtime.rootDir, "package.json"), "utf8")) as { version: string };
  const version = npmVersion(options.version ?? packageJson.version);
  const outputRoot = join(runtime.artifactsRoot, version);
  const packageRoot = join(outputRoot, "packages");
  const tarballRoot = join(outputRoot, "tarballs");
  const targets = resolveCliTargets(options.targets);

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });
  await mkdir(tarballRoot, { recursive: true });

  for (const target of targets) {
    const packageDir = join(packageRoot, platformPackageName(target.id));
    const binaryPath = join(packageDir, "bin", target.binaryName);
    await mkdir(join(packageDir, "bin"), { recursive: true });
    await runCommand(
      [
        "bun",
        "run",
        "package:cli",
        "--",
        `--target=${target.bunTarget}`,
        `--outdir=${join(packageDir, "bin")}`,
        `--outfile=${binaryPath}`
      ],
      runtime.rootDir
    );
    await chmod(binaryPath, 0o755);
    await writeJson(join(packageDir, "package.json"), {
      name: "recallbase",
      version: platformVersion(version, target.id),
      description: `Native RecallBase CLI binary for ${target.id}.`,
      license: "MIT",
      author: "Darin Rowe",
      homepage: "https://recallbase.net/desktop-cli/",
      repository: {
        type: "git",
        url: "git+https://github.com/DarinRowe/RecallBase.git"
      },
      bugs: {
        url: "https://github.com/DarinRowe/RecallBase/issues"
      },
      os: [target.id.split("-")[0]],
      cpu: [target.id.split("-")[1]],
      ...(target.libc ? { libc: [target.libc] } : {}),
      files: ["bin"]
    });
    await copyFile(join(runtime.rootDir, "README.md"), join(packageDir, "README.md"));
    await runCommand(["npm", "pack", packageDir, "--pack-destination", tarballRoot], runtime.rootDir);
  }

  const metaDir = join(packageRoot, "recallbase");
  await mkdir(join(metaDir, "bin"), { recursive: true });
  await writeJson(join(metaDir, "package.json"), {
    name: "recallbase",
    version,
    description: "Local-first CLI for importing, searching, and exposing AI conversation history to local agents.",
    license: "MIT",
    author: "Darin Rowe",
    homepage: "https://recallbase.net/desktop-cli/",
    repository: {
      type: "git",
      url: "git+https://github.com/DarinRowe/RecallBase.git"
    },
    bugs: {
      url: "https://github.com/DarinRowe/RecallBase/issues"
    },
    keywords: ["recallbase", "cli", "mcp-server", "local-first", "ai-chat", "conversation-history", "coding-agent"],
    engines: { node: ">=18" },
    bin: {
      rb: "bin/recallbase.cjs",
      recallbase: "bin/recallbase.cjs"
    },
    files: ["bin", "README.md"],
    optionalDependencies: Object.fromEntries(
      targets.map((target) => [platformPackageName(target.id), `npm:recallbase@${platformVersion(version, target.id)}`])
    )
  });
  await writeFile(join(metaDir, "bin", "recallbase.cjs"), npmShim(targets.map((target) => target.id)));
  await chmod(join(metaDir, "bin", "recallbase.cjs"), 0o755);
  await copyFile(join(runtime.rootDir, "README.md"), join(metaDir, "README.md"));
  await runCommand(["npm", "pack", metaDir, "--pack-destination", tarballRoot], runtime.rootDir);

  return outputRoot;
}

function npmShim(targetIds: string[]): string {
  const packageMap = Object.fromEntries(targetIds.map((id) => [id, platformPackageName(id)]));
  return `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");

const packages = ${JSON.stringify(packageMap, null, 2)};
const key = process.platform + "-" + process.arch;
const packageName = packages[key];

if (process.platform === "linux") {
  const report = process.report && process.report.getReport();
  if (report && report.header && !report.header.glibcVersionRuntime) {
    console.error("RecallBase prebuilt Linux binaries currently require glibc; musl/Alpine is not supported.");
    console.error("Use a glibc distribution or run RecallBase from source with Bun.");
    process.exit(1);
  }
}

if (!packageName) {
  console.error("RecallBase does not provide a prebuilt binary for " + key + ".");
  console.error("Supported platforms: " + Object.keys(packages).join(", ") + ".");
  process.exit(1);
}

const binaryName = process.platform === "win32" ? "rb.exe" : "rb";
let binaryPath;
try {
  binaryPath = require.resolve(packageName + "/bin/" + binaryName);
} catch (error) {
  console.error("RecallBase native package " + packageName + " was not installed.");
  console.error("Try reinstalling with npm install -g recallbase.");
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 0);
`;
}

function platformPackageName(targetId: string): string {
  return `recallbase-${targetId}`;
}

function platformVersion(version: string, targetId: string): string {
  return `${version}-${targetId}`;
}

function npmVersion(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

function parseTargets(value: string): CliTarget[] {
  return value.split(",").map((target) => target.trim() as CliTarget);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command: string[], cwd: string): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (!result.success) throw new Error(`Command failed: ${command.join(" ")}`);
}

if (import.meta.main) {
  const output = await packageNpmRelease(parsePackageNpmOptions(process.argv.slice(2)), defaultRuntime);
  console.log(output);
}
