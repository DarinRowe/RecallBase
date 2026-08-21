import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, win32 } from "node:path";
import { err, ok, type ExtensionHostInstallResult, type ExtensionHostManifestResult, type ResultEnvelope } from "@recallbase/contracts";
import {
  emptySavedChromiumTargets,
  loadSavedChromiumTargets,
  saveChromiumTargets,
  type SavedChromiumTargets
} from "../extension/host-target-store";
import { encodeNativeMessage } from "../extension/native-protocol";

export const EXTENSION_HOST_NAME = "ai.recallbase.extension_host";
export const CHROME_STORE_EXTENSION_ID = "fapgpimjelmfedlapidmfljcpmenmjeb";
export const EDGE_STORE_EXTENSION_ID = "gnlcemcmimkbgmnlclipknjjghllfdac";
export const DEFAULT_CHROME_EXTENSION_ID = "hagfpddjfmcfjnjghjogkibjilmkgfih";
export const DEFAULT_FIREFOX_EXTENSION_ID = "recallbase-capture@recallbase.net";

type NativeHostPlatform = "darwin" | "linux" | "win32";

export type NativeHostLaunch = {
  executablePath: string;
  args: string[];
};

type NativeHostRegistry = {
  writeDefaultValue(key: string, value: string): void;
  readDefaultValue(key: string): string | undefined;
  listNativeMessagingRoots(): string[];
};

type ExtensionInstallOptions = {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  hostLaunch?: NativeHostLaunch;
  platform?: NodeJS.Platform;
  registry?: NativeHostRegistry;
  healthCheck?: (hostPath: string, platform: NativeHostPlatform) => boolean;
  macApplicationRoots?: string[];
  macApplicationSupportDir?: string;
  readMacBrowserInfo?: (plistPath: string) => unknown;
  linuxConfigRoots?: string[];
  chromiumUserDataDirs?: string[];
  chromiumRegistryRoots?: string[];
  clearChromiumTargets?: boolean;
  targetStorePath?: string;
};

export type MacChromiumBrowser = {
  label: string;
  productDirName: string;
};

export type LinuxChromiumBrowser = {
  label: string;
  dataDir: string;
};

export type NativeHostManifestTarget = ExtensionHostManifestResult & {
  registryKey?: string;
};

export async function extensionInstallCommand(
  _context: unknown,
  rest: string[],
  options: ExtensionInstallOptions = {}
): Promise<ResultEnvelope<ExtensionHostInstallResult>> {
  const install = rest[0] !== "verify-host";
  if (rest.length > 1) {
    return err(install ? "extension-install-host" : "extension-verify-host", {
      code: "invalid_arguments",
      message: `Unknown extension argument '${rest[1]}'.`,
      hint: "Run rb extension --help."
    });
  }
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
  const hostLaunch = options.hostLaunch ?? resolveNativeHostLaunch(process.argv[1] ?? "rb");
  if (platform === "win32" && (hostLaunch.args.length > 0 || extname(hostLaunch.executablePath).toLowerCase() !== ".exe")) {
    return err(install ? "extension-install-host" : "extension-verify-host", {
      code: "invalid_arguments",
      message: "Windows native-host installation requires a compiled rb.exe.",
      hint: "Run the release CLI binary, then retry rb extension install-host."
    });
  }
  const hostPath = nativeHostWrapperPath(options.homeDir, platform);
  const extensionIds: { chromeExtensionId?: string; firefoxExtensionId?: string } = {};
  if (env.RECALLBASE_CHROME_EXTENSION_ID !== undefined) {
    extensionIds.chromeExtensionId = env.RECALLBASE_CHROME_EXTENSION_ID;
  }
  if (env.RECALLBASE_FIREFOX_EXTENSION_ID !== undefined) {
    extensionIds.firefoxExtensionId = env.RECALLBASE_FIREFOX_EXTENSION_ID;
  }
  const targetOptions: {
    homeDir?: string;
    platform: NativeHostPlatform;
    env?: NodeJS.ProcessEnv;
    chromiumBrowsers?: MacChromiumBrowser[];
    firefoxBrowserLabels?: string[];
    linuxChromiumBrowsers?: LinuxChromiumBrowser[];
    customChromiumUserDataDirs?: string[];
    windowsChromiumRegistryRoots?: string[];
  } = { platform, env };
  if (options.homeDir !== undefined) targetOptions.homeDir = options.homeDir;
  let targets: NativeHostManifestTarget[];
  let savedTargets: SavedChromiumTargets;
  try {
    savedTargets = resolveSavedChromiumTargets(options, platform, install);
    targetOptions.customChromiumUserDataDirs = savedTargets.userDataDirs;
    if (platform === "darwin") {
      const roots = options.macApplicationRoots ?? defaultMacApplicationRoots(options.homeDir);
      const infoCache = new Map<string, unknown>();
      const readInfo = (plistPath: string) => {
        if (!infoCache.has(plistPath)) {
          infoCache.set(plistPath, options.readMacBrowserInfo
            ? options.readMacBrowserInfo(plistPath)
            : readMacBrowserInfo(plistPath));
        }
        return infoCache.get(plistPath);
      };
      targetOptions.chromiumBrowsers = discoverMacChromiumBrowsers({
        roots,
        applicationSupportDir: options.macApplicationSupportDir ?? defaultMacApplicationSupportDir(options.homeDir),
        readInfo
      });
      targetOptions.firefoxBrowserLabels = discoverMacFirefoxBrowsers({ roots, readInfo });
    } else if (platform === "linux") {
      targetOptions.linuxChromiumBrowsers = discoverLinuxChromiumBrowsers({
        roots: options.linuxConfigRoots ?? defaultLinuxConfigRoots(options.homeDir, env)
      });
    } else {
      const ignoredRoots = new Set(savedTargets.ignoredRegistryRoots.map((root) => root.toLowerCase()));
      targetOptions.windowsChromiumRegistryRoots = [
        ...registry.listNativeMessagingRoots().filter((root) => {
          const normalized = normalizeWindowsNativeMessagingRoot(root);
          return normalized !== undefined && !ignoredRoots.has(normalized.toLowerCase());
        }),
        ...savedTargets.registryRoots
      ];
    }
    targets = nativeManifestTargets(hostPath, extensionIds, targetOptions);
  } catch (error) {
    return err(install ? "extension-install-host" : "extension-verify-host", {
      code: "invalid_arguments",
      message: error instanceof Error ? error.message : "Invalid native-host extension identity.",
      hint: "Use exact extension IDs and valid absolute Chromium target locations."
    });
  }
  if (install && shouldSaveChromiumTargets(options)) {
    try {
      saveChromiumTargets(chromiumTargetStorePath(options), savedTargets);
    } catch {
      return err("extension-install-host", {
        code: "source_unavailable",
        message: "RecallBase could not save the custom Chromium target configuration.",
        hint: "Check permissions for ~/.recallbase, then retry rb extension install-host."
      });
    }
  }
  if (install) writeHostWrapper(hostPath, hostLaunch, platform);
  const manifests = targets.map((target) => {
    if (install) writeManifest(target, { platform, registry });
    const installed = isManifestInstalled(target, hostLaunch, { platform, registry });
    const { registryKey: _registryKey, ...manifest } = target;
    return { ...manifest, installed };
  });
  const manifestsInstalled = manifests.every((manifest) => manifest.installed);
  const healthCheck = options.healthCheck ?? isNativeHostHealthy;
  const hostHealthy = manifestsInstalled && healthCheck(hostPath, platform);
  if (!manifestsInstalled || !hostHealthy) {
    const missing = manifests
      .filter((manifest) => !manifest.installed)
      .map((manifest) => manifest.browserLabel ?? manifest.browser);
    return err(install ? "extension-install-host" : "extension-verify-host", {
      code: "source_unavailable",
      message: missing.length > 0
        ? `Native host setup is incomplete for: ${missing.join(", ")}.`
        : "Native host is installed but did not pass its health check.",
      hint: install
        ? "Check filesystem permissions, then retry rb extension install-host."
        : "Run rb extension install-host, then retry rb extension verify-host.",
      details: { manifests, hostHealthy }
    });
  }
  return ok(install ? "extension-install-host" : "extension-verify-host", { manifests });
}

function resolveSavedChromiumTargets(
  options: ExtensionInstallOptions,
  platform: NativeHostPlatform,
  install: boolean
): SavedChromiumTargets {
  if (options.clearChromiumTargets && !install) {
    throw new Error("--clear-chromium-targets can only be used with install-host.");
  }
  if (platform === "win32" && (options.chromiumUserDataDirs?.length ?? 0) > 0) {
    throw new Error("--chromium-user-data-dir is only supported on macOS and Linux.");
  }
  if (platform !== "win32" && (options.chromiumRegistryRoots?.length ?? 0) > 0) {
    throw new Error("--chromium-registry-root is only supported on Windows.");
  }

  const existing = loadSavedChromiumTargets(chromiumTargetStorePath(options));
  const saved = options.clearChromiumTargets ? emptySavedChromiumTargets() : existing;
  if (options.clearChromiumTargets) {
    saved.ignoredRegistryRoots = [...existing.ignoredRegistryRoots, ...existing.registryRoots];
  }

  saved.userDataDirs = saved.userDataDirs.map((path) => normalizeSavedUserDataDir(path));
  saved.registryRoots = saved.registryRoots.map((root) => {
    const normalized = normalizeWindowsNativeMessagingRoot(root);
    if (!normalized) throw new Error(`Invalid saved Chromium registry root '${root}'.`);
    return normalized;
  });
  saved.ignoredRegistryRoots = saved.ignoredRegistryRoots.map((root) => {
    const normalized = normalizeWindowsNativeMessagingRoot(root);
    if (!normalized) throw new Error(`Invalid ignored Chromium registry root '${root}'.`);
    return normalized;
  });

  for (const path of options.chromiumUserDataDirs ?? []) {
    saved.userDataDirs.push(validateExplicitChromiumUserDataDir(path));
  }
  for (const root of options.chromiumRegistryRoots ?? []) {
    const normalized = normalizeWindowsNativeMessagingRoot(root);
    if (!normalized) {
      throw new Error(`Invalid Chromium registry root '${root}'. Expected HKCU\\Software\\...\\NativeMessagingHosts.`);
    }
    saved.registryRoots.push(normalized);
    saved.ignoredRegistryRoots = saved.ignoredRegistryRoots
      .filter((root) => root.toLowerCase() !== normalized.toLowerCase());
  }
  saved.userDataDirs = [...new Set(saved.userDataDirs)].sort((left, right) => left.localeCompare(right));
  saved.registryRoots = [...new Set(saved.registryRoots)].sort((left, right) => left.localeCompare(right));
  saved.ignoredRegistryRoots = [...new Set(saved.ignoredRegistryRoots)]
    .sort((left, right) => left.localeCompare(right));

  return saved;
}

function shouldSaveChromiumTargets(options: ExtensionInstallOptions): boolean {
  return Boolean(options.clearChromiumTargets
    || (options.chromiumUserDataDirs?.length ?? 0) > 0
    || (options.chromiumRegistryRoots?.length ?? 0) > 0);
}

function chromiumTargetStorePath(options: ExtensionInstallOptions): string {
  return options.targetStorePath
    ?? join(options.homeDir ?? homedir(), ".recallbase", "extension-host-targets.json");
}

function normalizeSavedUserDataDir(path: string): string {
  if (!isAbsolute(path)) throw new Error(`Saved Chromium user-data directory must be absolute: '${path}'.`);
  return resolve(path);
}

function validateExplicitChromiumUserDataDir(path: string): string {
  const dataDir = normalizeSavedUserDataDir(path);
  let stat;
  try {
    stat = statSync(dataDir);
  } catch {
    throw new Error(`Chromium user-data directory does not exist: '${path}'.`);
  }
  if (!stat.isDirectory() || !existsSync(join(dataDir, "Local State")) || !hasChromiumProfilePreferences(dataDir)) {
    throw new Error(`Not a Chromium user-data directory: '${path}'. Expected Local State and a profile Preferences file.`);
  }
  return dataDir;
}

function hasChromiumProfilePreferences(dataDir: string): boolean {
  try {
    return readdirSync(dataDir, { withFileTypes: true })
      .some((entry) => entry.isDirectory() && existsSync(join(dataDir, entry.name, "Preferences")));
  } catch {
    return false;
  }
}

function customChromiumLabel(dataDir: string): string {
  const parent = basename(dirname(dataDir));
  const name = basename(dataDir);
  return `${parent ? `${parent}/` : ""}${name} (custom)`;
}

export function nativeHostWrapperPath(homeDir = homedir(), platform: NativeHostPlatform = platformForPaths()): string {
  if (platform === "win32") return win32.join(homeDir, ".recallbase", "extension-host.exe");
  return join(homeDir, ".recallbase", "extension-host");
}

export function nativeManifestTargets(
  hostPath: string,
  ids: { chromeExtensionId?: string; firefoxExtensionId?: string } = {},
  options: {
    homeDir?: string;
    platform?: NativeHostPlatform;
    env?: NodeJS.ProcessEnv;
    chromiumBrowsers?: MacChromiumBrowser[];
    firefoxBrowserLabels?: string[];
    linuxChromiumBrowsers?: LinuxChromiumBrowser[];
    customChromiumUserDataDirs?: string[];
    windowsChromiumRegistryRoots?: string[];
  } | string = {}
): NativeHostManifestTarget[] {
  const homeDir = typeof options === "string" ? options : options.homeDir ?? homedir();
  const platform = typeof options === "string" ? "darwin" : options.platform ?? "darwin";
  const env = typeof options === "string" ? process.env : options.env ?? process.env;
  const chromiumIds = chromiumExtensionIds(ids.chromeExtensionId);
  const firefoxId = firefoxExtensionId(ids.firefoxExtensionId);
  const targets: NativeHostManifestTarget[] = [
    {
      browser: "chrome",
      ...(platform === "win32" ? { registryKey: nativeHostRegistryKey("chrome") } : {}),
      manifestPath: chromiumManifestPath("chrome", homeDir, platform, env),
      hostName: EXTENSION_HOST_NAME,
      binaryPath: hostPath,
      allowedIds: chromiumIds,
      installed: false
    },
    ...(platform === "win32" ? [] : [{
      browser: "chrome-for-testing" as const,
      manifestPath: chromiumManifestPath("chrome-for-testing", homeDir, platform, env),
      hostName: EXTENSION_HOST_NAME,
      binaryPath: hostPath,
      allowedIds: chromiumIds,
      installed: false
    }]),
    {
      browser: "chromium",
      ...(platform === "win32" ? { registryKey: nativeHostRegistryKey("chromium") } : {}),
      manifestPath: chromiumManifestPath("chromium", homeDir, platform, env),
      hostName: EXTENSION_HOST_NAME,
      binaryPath: hostPath,
      allowedIds: chromiumIds,
      installed: false
    },
    {
      browser: "edge",
      ...(platform === "win32" ? { registryKey: nativeHostRegistryKey("edge") } : {}),
      manifestPath: chromiumManifestPath("edge", homeDir, platform, env),
      hostName: EXTENSION_HOST_NAME,
      binaryPath: hostPath,
      allowedIds: chromiumIds,
      installed: false
    },
    {
      browser: "firefox",
      ...(platform === "win32" ? { registryKey: nativeHostRegistryKey("firefox") } : {}),
      ...(platform === "darwin" && typeof options !== "string" && options.firefoxBrowserLabels?.length
        ? { browserLabel: options.firefoxBrowserLabels.join(", ") }
        : {}),
      manifestPath: firefoxManifestPath(homeDir, platform, env),
      hostName: EXTENSION_HOST_NAME,
      binaryPath: hostPath,
      allowedIds: [firefoxId],
      installed: false
    }
  ];
  if (platform === "darwin" && typeof options !== "string") {
    for (const browser of options.chromiumBrowsers ?? []) {
      const manifestPath = macChromiumManifestPath(homeDir, browser.productDirName);
      if (!manifestPath) continue;
      targets.push({
        browser: "chromium",
        browserLabel: browser.label,
        manifestPath,
        hostName: EXTENSION_HOST_NAME,
        binaryPath: hostPath,
        allowedIds: chromiumIds,
        installed: false
      });
    }
  } else if (platform === "linux" && typeof options !== "string") {
    for (const browser of options.linuxChromiumBrowsers ?? []) {
      targets.push({
        browser: "chromium",
        browserLabel: browser.label,
        manifestPath: join(browser.dataDir, "NativeMessagingHosts", `${EXTENSION_HOST_NAME}.json`),
        hostName: EXTENSION_HOST_NAME,
        binaryPath: hostPath,
        allowedIds: chromiumIds,
        installed: false
      });
    }
  } else if (platform === "win32" && typeof options !== "string") {
    for (const registryRoot of options.windowsChromiumRegistryRoots ?? []) {
      const normalizedRoot = normalizeWindowsNativeMessagingRoot(registryRoot);
      if (!normalizedRoot) continue;
      targets.push({
        browser: "chromium",
        browserLabel: windowsBrowserLabel(normalizedRoot),
        registryKey: `${normalizedRoot}\\${EXTENSION_HOST_NAME}`,
        manifestPath: chromiumManifestPath("chromium", homeDir, platform, env),
        hostName: EXTENSION_HOST_NAME,
        binaryPath: hostPath,
        allowedIds: chromiumIds,
        installed: false
      });
    }
  }
  if (platform !== "win32" && typeof options !== "string") {
    for (const dataDir of options.customChromiumUserDataDirs ?? []) {
      targets.push({
        browser: "chromium",
        browserLabel: customChromiumLabel(dataDir),
        manifestPath: join(dataDir, "NativeMessagingHosts", `${EXTENSION_HOST_NAME}.json`),
        hostName: EXTENSION_HOST_NAME,
        binaryPath: hostPath,
        allowedIds: chromiumIds,
        installed: false
      });
    }
  }
  return dedupeManifestTargets(targets);
}

export function discoverMacChromiumBrowsers(options: {
  roots: string[];
  applicationSupportDir?: string;
  readInfo?: (plistPath: string) => unknown;
}): MacChromiumBrowser[] {
  const readInfo = options.readInfo ?? readMacBrowserInfo;
  const applicationSupportDir = options.applicationSupportDir ?? defaultMacApplicationSupportDir();
  const browsers: MacChromiumBrowser[] = [];
  for (const applicationPath of macApplicationBundles(options.roots)) {
    const info = readInfo(join(applicationPath, "Contents", "Info.plist"));
    if (!isRecord(info)) continue;
    const label = [info.CFBundleDisplayName, info.CFBundleName]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?? basename(applicationPath, ".app");
    const productDirName = info.CrProductDirName;
    if (isChromiumBrowserBundle(info) && typeof productDirName === "string" && productDirName.trim()) {
      browsers.push({ label, productDirName });
      continue;
    }
    for (const inferredProductDirName of inferMacChromiumProductDirs(applicationPath, info, applicationSupportDir)) {
      browsers.push({ label, productDirName: inferredProductDirName });
    }
  }
  return browsers;
}

export function discoverMacFirefoxBrowsers(options: {
  roots: string[];
  readInfo?: (plistPath: string) => unknown;
}): string[] {
  const readInfo = options.readInfo ?? readMacBrowserInfo;
  const labels = new Set<string>();
  for (const applicationPath of macApplicationBundles(options.roots)) {
    const info = readInfo(join(applicationPath, "Contents", "Info.plist"));
    if (!isRecord(info)
      || info.CFBundleExecutable !== "firefox"
      || typeof info.CFBundleIdentifier !== "string"
      || !info.CFBundleIdentifier.startsWith("org.mozilla.")) continue;
    const label = [info.CFBundleDisplayName, info.CFBundleName]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?? basename(applicationPath, ".app");
    labels.add(label);
  }
  return [...labels].sort((left, right) => left.localeCompare(right));
}

export function discoverLinuxChromiumBrowsers(options: {
  roots: string[];
}): LinuxChromiumBrowser[] {
  const browsers: LinuxChromiumBrowser[] = [];
  for (const root of options.roots) {
    const configRoot = resolve(root);
    for (const dataDir of chromiumUserDataRoots(configRoot, 3)) {
      const configDirName = relative(configRoot, dataDir);
      if (!isSafeRelativePath(configDirName)) continue;
      browsers.push({ label: configDirName, dataDir });
    }
  }
  return Array.from(new Map(browsers.map((browser) => [browser.dataDir, browser])).values())
    .sort((left, right) => left.label.localeCompare(right.label));
}

function defaultMacApplicationRoots(homeDir?: string): string[] {
  return homeDir === undefined
    ? ["/Applications", join(homedir(), "Applications")]
    : [join(homeDir, "Applications")];
}

function defaultMacApplicationSupportDir(homeDir = homedir()): string {
  return join(homeDir, "Library", "Application Support");
}

function defaultLinuxConfigRoots(homeDir = homedir(), env: NodeJS.ProcessEnv = process.env): string[] {
  return [linuxConfigDir(homeDir, env)];
}

function linuxConfigDir(homeDir: string, env: NodeJS.ProcessEnv): string {
  const chromeConfigHome = env.CHROME_CONFIG_HOME;
  if (chromeConfigHome && isAbsolute(chromeConfigHome)) return chromeConfigHome;
  const xdgConfigHome = env.XDG_CONFIG_HOME;
  return xdgConfigHome && isAbsolute(xdgConfigHome) ? xdgConfigHome : join(homeDir, ".config");
}

function macApplicationBundles(roots: string[]): string[] {
  const applications: string[] = [];
  const pending = roots.map((path) => ({ path, depth: 0 }));
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) break;
    let entries;
    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(current.path, entry.name);
      if (entry.name.endsWith(".app")) {
        applications.push(path);
      } else if (current.depth < 1) {
        pending.push({ path, depth: current.depth + 1 });
      }
    }
  }
  return applications;
}

function readMacBrowserInfo(plistPath: string): unknown {
  try {
    const result = Bun.spawnSync(["/usr/bin/plutil", "-convert", "json", "-o", "-", plistPath], {
      stdout: "pipe",
      stderr: "pipe"
    });
    if (!result.success) return undefined;
    return JSON.parse(result.stdout.toString());
  } catch {
    return undefined;
  }
}

function isChromiumBrowserBundle(info: Record<string, unknown>): boolean {
  const documentTypes = Array.isArray(info.CFBundleDocumentTypes) ? info.CFBundleDocumentTypes : [];
  return documentTypes.some((documentType) => {
    if (!isRecord(documentType) || !Array.isArray(documentType.LSItemContentTypes)) return false;
    return documentType.LSItemContentTypes.includes("org.chromium.extension");
  });
}

function inferMacChromiumProductDirs(
  applicationPath: string,
  info: Record<string, unknown>,
  applicationSupportDir: string
): string[] {
  if (!handlesWebUrls(info)) return [];
  const supportRoot = resolve(applicationSupportDir);
  const names = [info.CFBundleDisplayName, info.CFBundleName, info.CFBundleIdentifier, basename(applicationPath, ".app")]
    .filter((value): value is string => typeof value === "string" && isSafePathSegment(value.trim()))
    .map((value) => value.trim());
  const productDirs: string[] = [];
  for (const name of new Set(names)) {
    for (const userDataRoot of chromiumUserDataRoots(join(supportRoot, name), 2)) {
      const productDirName = relative(supportRoot, userDataRoot);
      if (isSafeMacChromiumProductDirName(productDirName)) productDirs.push(productDirName);
    }
  }
  return [...new Set(productDirs)];
}

function handlesWebUrls(info: Record<string, unknown>): boolean {
  const schemes = new Set<string>();
  const urlTypes = Array.isArray(info.CFBundleURLTypes) ? info.CFBundleURLTypes : [];
  for (const urlType of urlTypes) {
    if (!isRecord(urlType) || !Array.isArray(urlType.CFBundleURLSchemes)) continue;
    for (const scheme of urlType.CFBundleURLSchemes) {
      if (typeof scheme === "string") schemes.add(scheme.toLowerCase());
    }
  }
  return schemes.has("http") && schemes.has("https");
}

function chromiumUserDataRoots(root: string, maxDepth: number): string[] {
  const roots: string[] = [];
  const pending = [{ path: root, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) break;
    if (looksLikeChromiumUserDataRoot(current.path)) {
      roots.push(current.path);
      continue;
    }
    if (current.depth >= maxDepth) continue;
    let entries;
    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) pending.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
    }
  }
  return roots;
}

function looksLikeChromiumUserDataRoot(path: string): boolean {
  if (!existsSync(join(path, "Local State"))) return false;
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return false;
  }
  return entries.some((entry) => entry.isDirectory()
    && existsSync(join(path, entry.name, "Preferences"))
    && (existsSync(join(path, entry.name, "Extensions"))
      || existsSync(join(path, entry.name, "Local Extension Settings"))));
}

function isSafePathSegment(value: string): boolean {
  return Boolean(value) && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\");
}

function macChromiumManifestPath(homeDir: string, productDirName: string): string | undefined {
  if (!isSafeMacChromiumProductDirName(productDirName)) return undefined;
  const segments = productDirName.split("/");
  const applicationSupport = resolve(homeDir, "Library", "Application Support");
  const productPath = resolve(applicationSupport, ...segments);
  const childPath = relative(applicationSupport, productPath);
  if (!childPath || childPath.startsWith("..") || isAbsolute(childPath)) return undefined;
  return join(productPath, "NativeMessagingHosts", `${EXTENSION_HOST_NAME}.json`);
}

function isSafeMacChromiumProductDirName(productDirName: string): boolean {
  return isSafeRelativePath(productDirName);
}

function isSafeRelativePath(path: string): boolean {
  if (path.includes("\\") || isAbsolute(path)) return false;
  return path.split("/").every((segment) => isSafePathSegment(segment));
}

function dedupeManifestTargets(targets: NativeHostManifestTarget[]): NativeHostManifestTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const identity = target.registryKey ? `registry:${target.registryKey.toLowerCase()}` : `manifest:${target.manifestPath}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
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
  const vendor = browser === "firefox"
    ? "Mozilla"
    : browser === "edge"
      ? "Microsoft\\Edge"
      : browser === "chromium"
        ? "Chromium"
      : browser === "chrome-for-testing"
        ? "Google\\Chrome for Testing"
        : "Google\\Chrome";
  return `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${EXTENSION_HOST_NAME}`;
}

export function isManifestInstalled(
  target: NativeHostManifestTarget,
  hostLaunch?: NativeHostLaunch,
  options: { platform?: NativeHostPlatform; registry?: NativeHostRegistry } = {}
): boolean {
  if (target.allowedIds.length === 0) return false;
  if (!existsSync(target.manifestPath) || !existsSync(target.binaryPath)) return false;
  try {
    const binaryStat = statSync(target.binaryPath);
    if (!binaryStat.isFile()) return false;
    const platform = options.platform ?? platformForPaths();
    if (platform !== "win32" && (binaryStat.mode & 0o111) === 0) return false;
    if (hostLaunch !== undefined && !hostMatchesLaunch(target.binaryPath, hostLaunch, platform)) return false;
    if (platform === "win32"
      && options.registry?.readDefaultValue(target.registryKey ?? nativeHostRegistryKey(target.browser)) !== target.manifestPath) return false;
    const expected = target.browser === "firefox" ? firefoxNativeManifest(target) : chromeNativeManifest(target);
    const actual = JSON.parse(readFileSync(target.manifestPath, "utf8"));
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

function writeManifest(
  target: NativeHostManifestTarget,
  options: { platform: NativeHostPlatform; registry: NativeHostRegistry }
): void {
  if (target.allowedIds.length === 0) return;
  mkdirSync(directoryName(target.manifestPath, options.platform), { recursive: true });
  const manifest = target.browser === "firefox" ? firefoxNativeManifest(target) : chromeNativeManifest(target);
  assertNoWildcards(manifest);
  writeFileAtomically(target.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 0o644);
  if (options.platform === "win32") {
    options.registry.writeDefaultValue(target.registryKey ?? nativeHostRegistryKey(target.browser), target.manifestPath);
  }
}

function writeFileAtomically(path: string, contents: string, mode: number): void {
  const temporaryPath = join(dirname(path), `.${process.pid}.${Date.now()}.native-host.tmp`);
  try {
    writeFileSync(temporaryPath, contents, { mode });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function writeHostWrapper(hostPath: string, hostLaunch: NativeHostLaunch, platform: NativeHostPlatform): void {
  mkdirSync(directoryName(hostPath, platform), { recursive: true });
  if (platform === "win32") {
    if (resolve(hostPath) !== resolve(hostLaunch.executablePath)) copyFileSync(hostLaunch.executablePath, hostPath);
    return;
  }
  writeFileSync(hostPath, hostWrapperScript(hostLaunch), { mode: 0o755 });
  chmodSync(hostPath, 0o755);
}

function hostWrapperScript(hostLaunch: NativeHostLaunch): string {
  const command = [hostLaunch.executablePath, ...hostLaunch.args, "extension-host"].map(posixShellQuote).join(" ");
  return `#!/bin/sh\nexec ${command} "$@"\n`;
}

function posixShellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function directoryName(path: string, platform: NativeHostPlatform): string {
  return platform === "win32" ? win32.dirname(path) : dirname(path);
}

function hostMatchesLaunch(hostPath: string, hostLaunch: NativeHostLaunch, platform: NativeHostPlatform): boolean {
  if (platform === "win32") return readFileSync(hostPath).equals(readFileSync(hostLaunch.executablePath));
  return readFileSync(hostPath, "utf8") === hostWrapperScript(hostLaunch);
}

function chromiumManifestPath(
  browser: "chrome" | "chrome-for-testing" | "chromium" | "edge",
  homeDir: string,
  platform: NativeHostPlatform,
  env: NodeJS.ProcessEnv
): string {
  if (platform === "win32") {
    return win32.join(windowsDataDir(homeDir, env), "NativeMessagingHosts", `${EXTENSION_HOST_NAME}.${browser}.json`);
  }
  if (platform === "linux") {
    const browserDir = browser === "edge"
      ? "microsoft-edge"
      : browser === "chrome-for-testing"
        ? "google-chrome-for-testing"
        : browser === "chromium"
          ? "chromium"
          : "google-chrome";
    return join(linuxConfigDir(homeDir, env), browserDir, "NativeMessagingHosts", `${EXTENSION_HOST_NAME}.json`);
  }
  const browserDir = browser === "edge"
    ? "Microsoft Edge"
    : browser === "chrome-for-testing"
      ? "Google/ChromeForTesting"
      : browser === "chromium"
        ? "Chromium"
        : "Google/Chrome";
  return join(homeDir, `Library/Application Support/${browserDir}/NativeMessagingHosts`, `${EXTENSION_HOST_NAME}.json`);
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

function normalizeWindowsNativeMessagingRoot(root: string): string | undefined {
  const normalized = root.trim()
    .replace(/^HKEY_CURRENT_USER\\/i, "HKCU\\")
    .replace(/^HKCU\\SOFTWARE\\/i, "HKCU\\Software\\")
    .replace(/\\+$/, "");
  if (!/^HKCU\\Software\\.+\\NativeMessagingHosts$/i.test(normalized)) return undefined;
  return normalized;
}

function windowsBrowserLabel(registryRoot: string): string {
  const productPath = registryRoot
    .replace(/^HKCU\\Software\\/i, "")
    .replace(/\\NativeMessagingHosts$/i, "");
  return productPath.split("\\").slice(-2).join("/");
}

export function resolveNativeHostLaunch(candidate: string, executablePath = process.execPath): NativeHostLaunch {
  const executable = resolveBinaryPath(executablePath);
  if (isBunCompiledEntrypoint(candidate)) return { executablePath: executable, args: [] };
  return { executablePath: executable, args: [resolveBinaryPath(candidate)] };
}

function isBunCompiledEntrypoint(candidate: string): boolean {
  const normalized = candidate.replaceAll("\\", "/");
  return normalized.includes("/$bunfs/") || /^[a-z]:\/~bun\//i.test(normalized);
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

function chromiumExtensionIds(customId?: string): string[] {
  const ids = [CHROME_STORE_EXTENSION_ID, EDGE_STORE_EXTENSION_ID, DEFAULT_CHROME_EXTENSION_ID];
  if (customId !== undefined) ids.push(customId);
  for (const id of ids) {
    if (!/^[a-p]{32}$/.test(id)) throw new Error(`Invalid Chromium extension ID '${id}'.`);
  }
  return [...new Set(ids)];
}

export function isNativeHostHealthy(
  hostPath: string,
  platform: NativeHostPlatform = platformForPaths(),
  env: NodeJS.ProcessEnv = process.env
): boolean {
  try {
    const result = Bun.spawnSync([hostPath], {
      stdin: encodeNativeMessage({ type: "health", protocolVersion: 1 }),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        ...(platform === "win32" ? {} : { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }),
        RECALLBASE_DB: ":memory:"
      },
      timeout: 5_000,
      maxBuffer: 1024 * 1024
    });
    if (!result.success) return false;
    const response = decodeNativeResponse(result.stdout);
    return isRecord(response)
      && response.ok === true
      && response.type === "health"
      && response.protocolVersion === 1
      && typeof response.version === "string"
      && response.version.length > 0;
  } catch {
    return false;
  }
}

function firefoxExtensionId(customId?: string): string {
  const id = customId ?? DEFAULT_FIREFOX_EXTENSION_ID;
  if (!id.trim() || id.includes("*")) throw new Error(`Invalid Firefox extension ID '${id}'.`);
  return id;
}

function decodeNativeResponse(bytes: Uint8Array): unknown {
  if (bytes.byteLength < 4) throw new Error("Native response is missing a length prefix.");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (length > 1024 * 1024 || bytes.byteLength !== length + 4) throw new Error("Invalid native response length.");
  return JSON.parse(new TextDecoder().decode(bytes.slice(4)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

  listNativeMessagingRoots(): string[] {
    const result = Bun.spawnSync(["reg", "query", "HKCU\\Software", "/f", "NativeMessagingHosts", "/k", "/s"], {
      stdout: "pipe",
      stderr: "pipe"
    });
    if (!result.success) return [];
    const roots = result.stdout.toString().split(/\r?\n/)
      .map((line) => normalizeWindowsNativeMessagingRoot(line))
      .filter((root): root is string => root !== undefined);
    return [...new Set(roots)].sort((left, right) => left.localeCompare(right));
  }
}
