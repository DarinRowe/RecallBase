import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, win32 } from "node:path";
import { err, ok, type ExtensionHostInstallResult, type ExtensionHostManifestResult, type ResultEnvelope } from "@recallbase/contracts";
import type { CommandContext } from "./shared";

export const EXTENSION_HOST_NAME = "ai.recallbase.extension_host";
export const DEFAULT_CHROME_EXTENSION_ID = "hagfpddjfmcfjnjghjogkibjilmkgfih";
export const DEFAULT_FIREFOX_EXTENSION_ID = "recallbase-capture@recallbase.net";

type NativeHostPlatform = "darwin" | "linux" | "win32";

type NativeHostRegistry = {
  writeDefaultValue(key: string, value: string): void;
  readDefaultValue(key: string): string | undefined;
};

type ExtensionInstallOptions = {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  rbBinaryPath?: string;
  platform?: NodeJS.Platform;
  registry?: NativeHostRegistry;
};

export async function extensionInstallCommand(
  _context: CommandContext,
  rest: string[],
  options: ExtensionInstallOptions = {}
): Promise<ResultEnvelope<ExtensionHostInstallResult>> {
  const install = rest[0] !== "verify-host";
  const platform = options.platform ?? process.platform;
  if (!isSupportedNativeHostPlatform(platform)) {
    return err(install ? "extension-install-host" : "extension-verify-host", {
      code: "unsupported_platform",
      message: `Browser native-host installation is not implemented for ${platform}.`,
      hint: "Use macOS, Linux, or Windows for the current extension test release."
    });
  }
  const env = options.env ?? process.env;
  const registry = options.registry ?? new WindowsRegistry();
  const rbBinaryPath = options.rbBinaryPath ?? resolveHostBinaryPath(process.argv[1] ?? "rb");
  if (platform === "win32" && extname(rbBinaryPath).toLowerCase() !== ".exe") {
    return err(install ? "extension-install-host" : "extension-verify-host", {
      code: "invalid_arguments",
      message: "Windows native-host installation requires a compiled rb.exe.",
      hint: "Run the release CLI binary, then retry rb extension install-host."
    });
  }
  const hostPath = nativeHostWrapperPath(options.homeDir, platform);
  if (install) writeHostWrapper(hostPath, rbBinaryPath, platform);
  const extensionIds: { chromeExtensionId?: string; firefoxExtensionId?: string } = {};
  if (env.RECALLBASE_CHROME_EXTENSION_ID !== undefined) {
    extensionIds.chromeExtensionId = env.RECALLBASE_CHROME_EXTENSION_ID;
  }
  if (env.RECALLBASE_FIREFOX_EXTENSION_ID !== undefined) {
    extensionIds.firefoxExtensionId = env.RECALLBASE_FIREFOX_EXTENSION_ID;
  }
  const targetOptions: { homeDir?: string; platform: NativeHostPlatform; env?: NodeJS.ProcessEnv } = { platform, env };
  if (options.homeDir !== undefined) targetOptions.homeDir = options.homeDir;
  const manifests = nativeManifestTargets(hostPath, extensionIds, targetOptions).map((target) => {
    if (install) writeManifest(target, { platform, registry });
    return { ...target, installed: isManifestInstalled(target, rbBinaryPath, { platform, registry }) };
  });
  return ok(install ? "extension-install-host" : "extension-verify-host", { manifests });
}

export function nativeHostWrapperPath(homeDir = homedir(), platform: NativeHostPlatform = platformForPaths()): string {
  if (platform === "win32") return win32.join(homeDir, ".recallbase", "extension-host.exe");
  return join(homeDir, ".recallbase", "extension-host");
}

export function nativeManifestTargets(
  hostPath: string,
  ids: { chromeExtensionId?: string; firefoxExtensionId?: string } = {},
  options: { homeDir?: string; platform?: NativeHostPlatform; env?: NodeJS.ProcessEnv } | string = {}
): ExtensionHostManifestResult[] {
  const homeDir = typeof options === "string" ? options : options.homeDir ?? homedir();
  const platform = typeof options === "string" ? "darwin" : options.platform ?? "darwin";
  const env = typeof options === "string" ? process.env : options.env ?? process.env;
  return [
    {
      browser: "chrome",
      manifestPath: chromeManifestPath(homeDir, platform, env),
      hostName: EXTENSION_HOST_NAME,
      binaryPath: hostPath,
      allowedIds: [ids.chromeExtensionId ?? DEFAULT_CHROME_EXTENSION_ID],
      installed: false
    },
    {
      browser: "firefox",
      manifestPath: firefoxManifestPath(homeDir, platform, env),
      hostName: EXTENSION_HOST_NAME,
      binaryPath: hostPath,
      allowedIds: [ids.firefoxExtensionId ?? DEFAULT_FIREFOX_EXTENSION_ID],
      installed: false
    }
  ];
}

export function chromeNativeManifest(target: ExtensionHostManifestResult) {
  return {
    name: target.hostName,
    description: "RecallBase browser extension native messaging bridge",
    path: target.binaryPath,
    type: "stdio",
    allowed_origins: target.allowedIds.map((id) => `chrome-extension://${id}/`)
  };
}

export function firefoxNativeManifest(target: ExtensionHostManifestResult) {
  return {
    name: target.hostName,
    description: "RecallBase browser extension native messaging bridge",
    path: target.binaryPath,
    type: "stdio",
    allowed_extensions: target.allowedIds
  };
}

export function nativeHostRegistryKey(browser: ExtensionHostManifestResult["browser"]): string {
  const vendor = browser === "chrome" ? "Google\\Chrome" : "Mozilla";
  return `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${EXTENSION_HOST_NAME}`;
}

export function isManifestInstalled(
  target: ExtensionHostManifestResult,
  rbBinaryPath?: string,
  options: { platform?: NativeHostPlatform; registry?: NativeHostRegistry } = {}
): boolean {
  if (target.allowedIds.length === 0) return false;
  if (!existsSync(target.manifestPath) || !existsSync(target.binaryPath)) return false;
  try {
    if (!statSync(target.binaryPath).isFile()) return false;
    const platform = options.platform ?? platformForPaths();
    if (rbBinaryPath !== undefined && !hostMatchesBinary(target.binaryPath, rbBinaryPath, platform)) return false;
    if (platform === "win32" && options.registry?.readDefaultValue(nativeHostRegistryKey(target.browser)) !== target.manifestPath) return false;
    const expected = target.browser === "chrome" ? chromeNativeManifest(target) : firefoxNativeManifest(target);
    const actual = JSON.parse(readFileSync(target.manifestPath, "utf8"));
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

function writeManifest(
  target: ExtensionHostManifestResult,
  options: { platform: NativeHostPlatform; registry: NativeHostRegistry }
): void {
  if (target.allowedIds.length === 0) return;
  mkdirSync(directoryName(target.manifestPath, options.platform), { recursive: true });
  const manifest = target.browser === "chrome" ? chromeNativeManifest(target) : firefoxNativeManifest(target);
  assertNoWildcards(manifest);
  writeFileSync(target.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  if (options.platform === "win32") options.registry.writeDefaultValue(nativeHostRegistryKey(target.browser), target.manifestPath);
}

function writeHostWrapper(hostPath: string, rbBinaryPath: string, platform: NativeHostPlatform): void {
  mkdirSync(directoryName(hostPath, platform), { recursive: true });
  if (platform === "win32") {
    if (resolve(hostPath) !== resolve(rbBinaryPath)) copyFileSync(rbBinaryPath, hostPath);
    return;
  }
  writeFileSync(hostPath, hostWrapperScript(rbBinaryPath), { mode: 0o755 });
  chmodSync(hostPath, 0o755);
}

function hostWrapperScript(rbBinaryPath: string): string {
  return `#!/bin/sh\nexec ${JSON.stringify(rbBinaryPath)} extension-host "$@"\n`;
}

function directoryName(path: string, platform: NativeHostPlatform): string {
  return platform === "win32" ? win32.dirname(path) : dirname(path);
}

function hostMatchesBinary(hostPath: string, rbBinaryPath: string, platform: NativeHostPlatform): boolean {
  if (platform === "win32") return readFileSync(hostPath).equals(readFileSync(rbBinaryPath));
  return readFileSync(hostPath, "utf8") === hostWrapperScript(rbBinaryPath);
}

function chromeManifestPath(homeDir: string, platform: NativeHostPlatform, env: NodeJS.ProcessEnv): string {
  if (platform === "linux") return join(homeDir, ".config/google-chrome/NativeMessagingHosts", `${EXTENSION_HOST_NAME}.json`);
  if (platform === "win32") return win32.join(windowsDataDir(homeDir, env), "NativeMessagingHosts", `${EXTENSION_HOST_NAME}.chrome.json`);
  return join(homeDir, "Library/Application Support/Google/Chrome/NativeMessagingHosts", `${EXTENSION_HOST_NAME}.json`);
}

function firefoxManifestPath(homeDir: string, platform: NativeHostPlatform, env: NodeJS.ProcessEnv): string {
  if (platform === "linux") return join(homeDir, ".mozilla/native-messaging-hosts", `${EXTENSION_HOST_NAME}.json`);
  if (platform === "win32") return win32.join(windowsDataDir(homeDir, env), "NativeMessagingHosts", `${EXTENSION_HOST_NAME}.firefox.json`);
  return join(homeDir, "Library/Application Support/Mozilla/NativeMessagingHosts", `${EXTENSION_HOST_NAME}.json`);
}

function isSupportedNativeHostPlatform(platform: NodeJS.Platform): platform is NativeHostPlatform {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

function platformForPaths(): NativeHostPlatform {
  return isSupportedNativeHostPlatform(process.platform) ? process.platform : "darwin";
}

function windowsDataDir(homeDir: string, env: NodeJS.ProcessEnv): string {
  return win32.join(env.LOCALAPPDATA ?? win32.join(homeDir, "AppData", "Local"), "RecallBase");
}

export function resolveHostBinaryPath(candidate: string, executablePath = process.execPath): string {
  return resolveBinaryPath(candidate.includes("$bunfs") ? executablePath : candidate);
}

function resolveBinaryPath(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return resolve(candidate);
  }
}

function assertNoWildcards(manifest: unknown): void {
  const text = JSON.stringify(manifest);
  if (text.includes("*")) throw new Error("Native messaging manifest allowlists must not use wildcards.");
}

class WindowsRegistry implements NativeHostRegistry {
  writeDefaultValue(key: string, value: string): void {
    const result = Bun.spawnSync(["reg", "add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"], {
      stdout: "pipe",
      stderr: "pipe"
    });
    if (!result.success) throw new Error(`Failed to write native host registry key ${key}: ${result.stderr.toString()}`);
  }

  readDefaultValue(key: string): string | undefined {
    const result = Bun.spawnSync(["reg", "query", key, "/ve"], { stdout: "pipe", stderr: "pipe" });
    if (!result.success) return undefined;
    const line = result.stdout.toString().split(/\r?\n/).find((entry) => entry.includes("REG_SZ"));
    return line?.replace(/^.*REG_SZ\s+/, "").trim();
  }
}
