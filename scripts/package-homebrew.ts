import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type PackageHomebrewOptions = {
  version?: string;
  repo: string;
  releaseRoot?: string;
  out?: string;
};

type ReleaseManifest = {
  version: string;
  artifacts: Array<{ name: string; sha256: string }>;
};

export function parsePackageHomebrewOptions(args: string[]): PackageHomebrewOptions {
  const options: PackageHomebrewOptions = { repo: "DarinRowe/RecallBase" };
  for (const arg of args) {
    if (arg.startsWith("--version=")) options.version = arg.slice("--version=".length);
    else if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
    else if (arg.startsWith("--release-root=")) options.releaseRoot = arg.slice("--release-root=".length);
    else if (arg.startsWith("--out=")) options.out = arg.slice("--out=".length);
    else throw new Error(`Unknown package-homebrew option: ${arg}`);
  }
  return options;
}

export async function packageHomebrewCask(
  options: PackageHomebrewOptions,
  rootDir = process.cwd()
): Promise<string> {
  const releaseRoot = options.releaseRoot ?? join(rootDir, ".artifacts", "release");
  const manifestVersion = options.version?.startsWith("v") ? options.version : options.version ? `v${options.version}` : undefined;
  const version = manifestVersion ?? (JSON.parse(await readFile(join(rootDir, "package.json"), "utf8")) as { version: string }).version;
  const releaseVersion = version.startsWith("v") ? version : `v${version}`;
  const manifest = JSON.parse(await readFile(join(releaseRoot, releaseVersion, "manifest.json"), "utf8")) as ReleaseManifest;
  const caskVersion = manifest.version.replace(/^v/, "");
  const arm = findArtifact(manifest, "aarch64-apple-darwin");
  const intel = findArtifact(manifest, "x86_64-apple-darwin");
  const outPath = options.out ?? join(rootDir, ".artifacts", "homebrew", "Casks", "recallbase.rb");

  await mkdir(join(outPath, ".."), { recursive: true });
  await writeFile(outPath, cask({ repo: options.repo, version: caskVersion, releaseVersion: manifest.version, arm, intel }));
  return outPath;
}

function findArtifact(manifest: ReleaseManifest, target: string): { name: string; sha256: string } {
  const artifact = manifest.artifacts.find((candidate) => candidate.name.includes(target) && candidate.name.endsWith(".tar.gz"));
  if (!artifact) throw new Error(`Release manifest is missing ${target} CLI artifact`);
  return artifact;
}

function cask(input: {
  repo: string;
  version: string;
  releaseVersion: string;
  arm: { name: string; sha256: string };
  intel: { name: string; sha256: string };
}): string {
  const baseUrl = `https://github.com/${input.repo}/releases/download/${input.releaseVersion}`;
  return `cask "recallbase" do
  version "${input.version}"

  on_arm do
    sha256 "${input.arm.sha256}"
    url "${baseUrl}/${input.arm.name}"
  end

  on_intel do
    sha256 "${input.intel.sha256}"
    url "${baseUrl}/${input.intel.name}"
  end

  name "RecallBase"
  desc "Local-first memory layer for AI-assisted coding work"
  homepage "https://github.com/${input.repo}"

  binary "rb"
  binary "rb", target: "recallbase"
end
`;
}

if (import.meta.main) {
  const output = await packageHomebrewCask(parsePackageHomebrewOptions(process.argv.slice(2)));
  console.log(output);
}
