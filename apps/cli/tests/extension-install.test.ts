import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseFlags } from "../src/config";
import {
  DEFAULT_FIREFOX_EXTENSION_ID,
  DEFAULT_CHROME_EXTENSION_ID,
  chromeNativeManifest,
  discoverMacChromiumBrowsers,
  discoverMacFirefoxBrowsers,
  discoverLinuxChromiumBrowsers,
  extensionInstallCommand,
  firefoxNativeManifest,
  isManifestInstalled,
  isNativeHostHealthy,
  nativeHostRegistryKey,
  nativeHostWrapperPath,
  nativeManifestTargets,
  resolveNativeHostLaunch,
  windowsNativeMessagingRootFromRegistryLine
} from "../src/commands/extension-install";

class MemoryRegistry {
  values = new Map<string, string>();
  nativeMessagingRoots: string[] = [];

  writeDefaultValue(key: string, value: string): void {
    this.values.set(key, value);
  }

  readDefaultValue(key: string): string | undefined {
    return this.values.get(key);
  }

  listNativeMessagingRoots(): string[] {
    return this.nativeMessagingRoots;
  }
}

describe("extension native host install manifests", () => {
  test("parses repeatable universal Chromium target flags", () => {
    const parsed = parseFlags([
      "extension",
      "install-host",
      "--chromium-user-data-dir", "/profiles/one",
      "--chromium-user-data-dir", "/profiles/two",
      "--chromium-registry-root", "HKCU\\Software\\Vendor\\Browser\\NativeMessagingHosts",
      "--clear-chromium-targets"
    ]);

    expect(parsed.command).toBe("extension");
    expect(parsed.rest).toEqual(["install-host"]);
    expect(parsed.flags.chromiumUserDataDirs).toEqual(["/profiles/one", "/profiles/two"]);
    expect(parsed.flags.chromiumRegistryRoots).toEqual(["HKCU\\Software\\Vendor\\Browser\\NativeMessagingHosts"]);
    expect(parsed.flags.clearChromiumTargets).toBe(true);
  });

  test("reports installed official Firefox channels that share the Mozilla manifest", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-firefox-discovery-"));
    const applications = join(homeDir, "Applications");
    for (const name of ["Firefox.app", "Firefox Developer Edition.app", "Firefox Nightly.app", "Tor Browser.app"]) {
      mkdirSync(join(applications, name, "Contents"), { recursive: true });
    }

    const labels = discoverMacFirefoxBrowsers({
      roots: [applications],
      readInfo: (plistPath) => {
        const appName = plistPath.split("/").at(-3)?.replace(/\.app$/, "") ?? "";
        if (appName === "Tor Browser") {
          return { CFBundleName: appName, CFBundleIdentifier: "org.torproject.torbrowser", CFBundleExecutable: "firefox" };
        }
        const suffix = appName === "Firefox"
          ? "firefox"
          : appName === "Firefox Developer Edition"
            ? "firefoxdeveloperedition"
            : "nightly";
        return { CFBundleName: appName, CFBundleIdentifier: `org.mozilla.${suffix}`, CFBundleExecutable: "firefox" };
      }
    });

    expect(labels).toEqual(["Firefox", "Firefox Developer Edition", "Firefox Nightly"]);
    expect(labels).not.toContain("Tor Browser");
    const firefoxTarget = nativeManifestTargets("/Users/example/.recallbase/extension-host", {}, {
      homeDir: "/Users/example",
      platform: "darwin",
      firefoxBrowserLabels: labels
    }).find((target) => target.browser === "firefox");
    expect(firefoxTarget?.browserLabel).toBe("Firefox, Firefox Developer Edition, Firefox Nightly");
  });

  test("discovers Dia from its established Chromium user-data root", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-dia-discovery-"));
    const applications = join(homeDir, "Applications");
    const applicationSupport = join(homeDir, "Library", "Application Support");
    mkdirSync(join(applications, "Dia.app", "Contents"), { recursive: true });
    mkdirSync(join(applicationSupport, "Dia", "User Data", "Default", "Extensions"), { recursive: true });
    writeFileSync(join(applicationSupport, "Dia", "User Data", "Local State"), "{}\n");
    writeFileSync(join(applicationSupport, "Dia", "User Data", "Default", "Preferences"), "{}\n");

    const browsers = discoverMacChromiumBrowsers({
      roots: [applications],
      applicationSupportDir: applicationSupport,
      readInfo: () => ({
        CFBundleIdentifier: "company.thebrowser.dia",
        CFBundleName: "Dia",
        CFBundleURLTypes: [{ CFBundleURLSchemes: ["http", "https"] }]
      })
    });

    expect(browsers).toEqual([{ label: "Dia", productDirName: "Dia/User Data" }]);
  });

  test("discovers Arc from its established Chromium user-data root", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-arc-discovery-"));
    const applications = join(homeDir, "Applications");
    const applicationSupport = join(homeDir, "Library", "Application Support");
    mkdirSync(join(applications, "Arc.app", "Contents"), { recursive: true });
    mkdirSync(join(applicationSupport, "Arc", "User Data", "Default", "Extensions"), { recursive: true });
    writeFileSync(join(applicationSupport, "Arc", "User Data", "Local State"), "{}\n");
    writeFileSync(join(applicationSupport, "Arc", "User Data", "Default", "Preferences"), "{}\n");

    const browsers = discoverMacChromiumBrowsers({
      roots: [applications],
      applicationSupportDir: applicationSupport,
      readInfo: () => ({
        CFBundleIdentifier: "company.thebrowser.Browser",
        CFBundleName: "Arc",
        CFBundleURLTypes: [{ CFBundleURLSchemes: ["http", "https"] }]
      })
    });

    expect(browsers).toEqual([{ label: "Arc", productDirName: "Arc/User Data" }]);
    const targets = nativeManifestTargets("/Users/example/.recallbase/extension-host", {}, {
      homeDir: "/Users/example",
      platform: "darwin",
      chromiumBrowsers: browsers
    });
    expect(targets).toContainEqual(expect.objectContaining({
      browserLabel: "Arc",
      manifestPath: "/Users/example/Library/Application Support/Arc/User Data/NativeMessagingHosts/ai.recallbase.extension_host.json"
    }));
  });

  test("discovers installed macOS Chromium browsers without treating Electron apps as browsers", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-browser-discovery-"));
    const applications = join(homeDir, "Applications");
    for (const relativePath of [
      "ego lite.app",
      "Google Chrome.app",
      "ChatGPT.app",
      "Unsafe Browser.app",
      "Setapp/Brave Browser.app"
    ]) {
      mkdirSync(join(applications, relativePath, "Contents"), { recursive: true });
    }
    const chromiumDocumentType = [{ LSItemContentTypes: ["org.chromium.extension"] }];
    const browsers = discoverMacChromiumBrowsers({
      roots: [applications],
      readInfo: (plistPath) => {
        if (plistPath.includes("ego lite.app")) {
          return {
            CFBundleName: "ego lite",
            CrProductDirName: "Citro Labs/ego lite",
            CFBundleDocumentTypes: chromiumDocumentType
          };
        }
        if (plistPath.includes("Google Chrome.app")) {
          return {
            CFBundleName: "Google Chrome",
            CrProductDirName: "Google/Chrome",
            CFBundleDocumentTypes: chromiumDocumentType
          };
        }
        if (plistPath.includes("Brave Browser.app")) {
          return {
            CFBundleDisplayName: "Brave Browser",
            CrProductDirName: "BraveSoftware/Brave-Browser",
            CFBundleDocumentTypes: chromiumDocumentType
          };
        }
        if (plistPath.includes("Unsafe Browser.app")) {
          return {
            CFBundleName: "Unsafe Browser",
            CrProductDirName: "../../escape",
            CFBundleDocumentTypes: chromiumDocumentType
          };
        }
        return { CFBundleName: "ChatGPT", CrProductDirName: "com.openai.codex" };
      }
    });

    expect(browsers).toHaveLength(4);
    expect(browsers).toEqual(expect.arrayContaining([
      { label: "ego lite", productDirName: "Citro Labs/ego lite" },
      { label: "Google Chrome", productDirName: "Google/Chrome" },
      { label: "Brave Browser", productDirName: "BraveSoftware/Brave-Browser" }
    ]));
    expect(browsers.some((browser) => browser.label === "ChatGPT")).toBe(false);

    const targets = nativeManifestTargets("/Users/example/.recallbase/extension-host", {}, {
      homeDir: "/Users/example",
      platform: "darwin",
      chromiumBrowsers: browsers
    });
    const detected = targets.filter((target) => target.browser === "chromium" && target.browserLabel);
    expect(detected.map((target) => [target.browserLabel, target.manifestPath])).toEqual(expect.arrayContaining([
      ["ego lite", "/Users/example/Library/Application Support/Citro Labs/ego lite/NativeMessagingHosts/ai.recallbase.extension_host.json"],
      ["Brave Browser", "/Users/example/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/ai.recallbase.extension_host.json"]
    ]));
    expect(detected).toHaveLength(2);
    expect(targets.filter((target) => target.manifestPath.includes("Google/Chrome/NativeMessagingHosts"))).toHaveLength(1);
    expect(targets.some((target) => target.manifestPath.includes("escape"))).toBe(false);
  });

  test("generates exact Chromium-store and Firefox allowlists with no wildcards", () => {
    const targets = nativeManifestTargets("/Users/example/.recallbase/extension-host", {
      chromeExtensionId: "abcdefghijklmnopabcdefghijklmnop"
    });
    const chromeTarget = targets.find((target) => target.browser === "chrome");
    const firefoxTarget = targets.find((target) => target.browser === "firefox");
    const chromeManifest = chromeNativeManifest(chromeTarget!);
    const firefoxManifest = firefoxNativeManifest(firefoxTarget!);

    expect(chromeManifest.allowed_origins).toEqual([
      "chrome-extension://fapgpimjelmfedlapidmfljcpmenmjeb/",
      "chrome-extension://gnlcemcmimkbgmnlclipknjjghllfdac/",
      "chrome-extension://hagfpddjfmcfjnjghjogkibjilmkgfih/",
      "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"
    ]);
    // Firefox Extension 0.1.1 add-on ID; literal so a regression to .local fails
    expect(firefoxManifest.allowed_extensions).toEqual(["recallbase-capture@recallbase.net"]);
    expect(firefoxTarget?.allowedIds).toEqual(["recallbase-capture@recallbase.net"]);
    expect(DEFAULT_FIREFOX_EXTENSION_ID).toBe("recallbase-capture@recallbase.net");
    expect(chromeManifest.path).toBe("/Users/example/.recallbase/extension-host");
    expect(JSON.stringify(chromeManifest)).not.toContain("*");
    expect(JSON.stringify(firefoxManifest)).not.toContain("*");
  });

  test("uses all published Chromium identities plus the stable development ID by default", () => {
    const targets = nativeManifestTargets("/Users/example/.recallbase/extension-host");
    const chromeTarget = targets.find((target) => target.browser === "chrome");
    const edgeTarget = targets.find((target) => target.browser === "edge");

    expect(chromeTarget?.allowedIds).toEqual([
      "fapgpimjelmfedlapidmfljcpmenmjeb",
      "gnlcemcmimkbgmnlclipknjjghllfdac",
      DEFAULT_CHROME_EXTENSION_ID
    ]);
    expect(edgeTarget?.allowedIds).toEqual(chromeTarget?.allowedIds);
  });

  test("uses the Firefox Extension 0.1.1 add-on ID by default", () => {
    const firefoxTarget = nativeManifestTargets("/Users/example/.recallbase/extension-host")
      .find((target) => target.browser === "firefox");

    expect(firefoxTarget?.allowedIds).toEqual(["recallbase-capture@recallbase.net"]);
    expect(firefoxNativeManifest(firefoxTarget!).allowed_extensions).toEqual(["recallbase-capture@recallbase.net"]);
  });

  test("RECALLBASE_FIREFOX_EXTENSION_ID overrides the Firefox default", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-ff-override-"));
    const customFirefoxId = "recallbase-capture@dev.example";
    const env = {
      RECALLBASE_CHROME_EXTENSION_ID: "abcdefghijklmnopabcdefghijklmnop",
      RECALLBASE_FIREFOX_EXTENSION_ID: customFirefoxId
    };

    const install = await extensionInstallCommand({} as Parameters<typeof extensionInstallCommand>[0], ["install-host"], {
      homeDir,
      env,
      hostLaunch: { executablePath: "/opt/recallbase/rb", args: [] },
      platform: "darwin",
      healthCheck: () => true
    });

    expect(install.ok).toBe(true);
    if (!install.ok) throw new Error("expected install to succeed");
    const firefoxManifest = install.data.manifests.find((manifest) => manifest.browser === "firefox");
    expect(firefoxManifest?.allowedIds).toEqual([customFirefoxId]);
    expect(JSON.parse(readFileSync(firefoxManifest!.manifestPath, "utf8")).allowed_extensions).toEqual([customFirefoxId]);
  });

  test("rejects wildcard or malformed alternate extension IDs", async () => {
    const context = {} as Parameters<typeof extensionInstallCommand>[0];
    const options = {
      homeDir: mkdtempSync(join(tmpdir(), "recallbase-invalid-id-")),
      hostLaunch: { executablePath: "/opt/recallbase/rb", args: [] },
      platform: "darwin" as const,
      healthCheck: () => true
    };

    const chromium = await extensionInstallCommand(context, ["install-host"], {
      ...options,
      env: { RECALLBASE_CHROME_EXTENSION_ID: "not-a-chromium-id" }
    });
    const firefox = await extensionInstallCommand(context, ["install-host"], {
      ...options,
      env: { RECALLBASE_FIREFOX_EXTENSION_ID: "*" }
    });

    expect(chromium.ok).toBe(false);
    expect(firefox.ok).toBe(false);
    if (chromium.ok || firefox.ok) throw new Error("expected invalid identities to fail");
    expect(chromium.error.code).toBe("invalid_arguments");
    expect(firefox.error.code).toBe("invalid_arguments");
  });

  test("verifies wrapper existence and exact manifest contents", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "recallbase-host-"));
    const [chromeTarget] = nativeManifestTargets(join(tempDir, "extension-host"), {
      chromeExtensionId: "abcdefghijklmnopabcdefghijklmnop"
    });
    const target = {
      ...chromeTarget!,
      manifestPath: join(tempDir, "NativeMessagingHosts", "ai.recallbase.extension_host.json")
    };
    mkdirSync(dirname(target.manifestPath), { recursive: true });
    writeFileSync(target.binaryPath, "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(target.manifestPath, `${JSON.stringify(chromeNativeManifest(target), null, 2)}\n`);

    expect(isManifestInstalled(target)).toBe(true);
    writeFileSync(target.manifestPath, `${JSON.stringify({ ...chromeNativeManifest(target), allowed_origins: [] })}\n`);
    expect(isManifestInstalled(target)).toBe(false);
  });

  test("fails verification when the wrapper points at a stale rb binary", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "recallbase-host-"));
    const [chromeTarget] = nativeManifestTargets(join(tempDir, "extension-host"), {
      chromeExtensionId: "abcdefghijklmnopabcdefghijklmnop"
    });
    const target = {
      ...chromeTarget!,
      manifestPath: join(tempDir, "NativeMessagingHosts", "ai.recallbase.extension_host.json")
    };
    mkdirSync(dirname(target.manifestPath), { recursive: true });
    writeFileSync(target.binaryPath, "#!/bin/sh\nexec \"/old/rb\" extension-host \"$@\"\n");
    writeFileSync(target.manifestPath, `${JSON.stringify(chromeNativeManifest(target), null, 2)}\n`);

    expect(isManifestInstalled(target, { executablePath: "/new/rb", args: [] })).toBe(false);
  });

  test("fails verification when a POSIX host wrapper is not executable", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "recallbase-host-mode-"));
    const [chromeTarget] = nativeManifestTargets(join(tempDir, "extension-host"));
    const target = {
      ...chromeTarget!,
      manifestPath: join(tempDir, "NativeMessagingHosts", "ai.recallbase.extension_host.json")
    };
    mkdirSync(dirname(target.manifestPath), { recursive: true });
    writeFileSync(target.binaryPath, "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(target.manifestPath, `${JSON.stringify(chromeNativeManifest(target), null, 2)}\n`);
    chmodSync(target.binaryPath, 0o644);

    expect(isManifestInstalled(target, undefined, { platform: "darwin" })).toBe(false);
  });

  test("compiled Bun builds install the real executable path, not the virtual bunfs entrypoint", () => {
    expect(resolveNativeHostLaunch("/$bunfs/root/cli.js", "/opt/recallbase/rb")).toEqual({
      executablePath: resolve("/opt/recallbase/rb"),
      args: []
    });
    expect(resolveNativeHostLaunch("B:/~BUN/root/cli.js", "C:\\Program Files\\RecallBase\\rb.exe")).toEqual({
      executablePath: resolve("C:\\Program Files\\RecallBase\\rb.exe"),
      args: []
    });
    expect(resolveNativeHostLaunch("B:\\~BUN\\root\\cli.js", "C:\\Program Files\\RecallBase\\rb.exe")).toEqual({
      executablePath: resolve("C:\\Program Files\\RecallBase\\rb.exe"),
      args: []
    });
  });

  test("source installs pin the Bun runtime and pass health with a GUI-safe PATH", async () => {
    if (process.platform === "win32") return;
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-source-host-"));
    const cliPath = resolve(import.meta.dir, "../src/cli.ts");
    const hostLaunch = resolveNativeHostLaunch(cliPath, process.execPath);

    expect(hostLaunch).toEqual({
      executablePath: process.execPath,
      args: [cliPath]
    });

    const install = await extensionInstallCommand({} as Parameters<typeof extensionInstallCommand>[0], ["install-host"], {
      homeDir,
      env: {},
      hostLaunch,
      platform: "darwin",
      healthCheck: (hostPath, platform) => isNativeHostHealthy(hostPath, platform, {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        RECALLBASE_DB: ":memory:"
      })
    });

    expect(install.ok).toBe(true);
    const wrapper = readFileSync(join(homeDir, ".recallbase", "extension-host"), "utf8");
    expect(wrapper).toContain(process.execPath);
    expect(wrapper).toContain(cliPath);
    expect(wrapper).not.toContain("#!/usr/bin/env bun");
  });

  test("install-host writes wrapper and manifests, verify-host only checks current state", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-install-"));
    const context = {} as Parameters<typeof extensionInstallCommand>[0];
    const env = {
      RECALLBASE_CHROME_EXTENSION_ID: "abcdefghijklmnopabcdefghijklmnop"
    };

    const install = await extensionInstallCommand(context, ["install-host"], {
      homeDir,
      env,
      hostLaunch: { executablePath: "/opt/recallbase/rb", args: [] },
      platform: "darwin",
      healthCheck: () => true
    });

    expect(install.ok).toBe(true);
    if (!install.ok) throw new Error("expected install to succeed");
    expect(install.data.manifests.map((manifest) => [manifest.browser, manifest.installed])).toEqual([
      ["chrome", true],
      ["chrome-for-testing", true],
      ["chromium", true],
      ["edge", true],
      ["firefox", true]
    ]);
    const wrapperPath = join(homeDir, ".recallbase", "extension-host");
    expect(readFileSync(wrapperPath, "utf8")).toBe("#!/bin/sh\nexec '/opt/recallbase/rb' 'extension-host' \"$@\"\n");
    expect(statSync(wrapperPath).mode & 0o111).toBeGreaterThan(0);

    const verify = await extensionInstallCommand(context, ["verify-host"], {
      homeDir,
      env,
      hostLaunch: { executablePath: "/opt/recallbase/rb", args: [] },
      platform: "darwin",
      healthCheck: () => true
    });

    expect(verify.ok).toBe(true);
    if (!verify.ok) throw new Error("expected verify to succeed");
    expect(verify.data.manifests.every((manifest) => manifest.installed)).toBe(true);
  });

  test("install-host and verify-host share detected macOS Chromium targets", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-detected-browser-install-"));
    const applications = join(homeDir, "Applications");
    mkdirSync(join(applications, "ego lite.app", "Contents"), { recursive: true });
    const options = {
      homeDir,
      env: {},
      hostLaunch: { executablePath: "/opt/recallbase/rb", args: [] },
      platform: "darwin" as const,
      healthCheck: () => true,
      macApplicationRoots: [applications],
      readMacBrowserInfo: () => ({
        CFBundleName: "ego lite",
        CrProductDirName: "Citro Labs/ego lite",
        CFBundleDocumentTypes: [{ LSItemContentTypes: ["org.chromium.extension"] }]
      })
    };
    const context = {} as Parameters<typeof extensionInstallCommand>[0];

    const missing = await extensionInstallCommand(context, ["verify-host"], options);
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("expected detected browser verification to fail before install");
    expect(missing.error.message).toContain("ego lite");

    const install = await extensionInstallCommand(context, ["install-host"], options);
    expect(install.ok).toBe(true);
    if (!install.ok) throw new Error("expected detected browser install to succeed");
    const egoManifest = install.data.manifests.find((manifest) => manifest.browserLabel === "ego lite");
    expect(egoManifest).toMatchObject({ browser: "chromium", installed: true });

    const verify = await extensionInstallCommand(context, ["verify-host"], options);
    expect(verify.ok).toBe(true);
    if (!verify.ok) throw new Error("expected detected browser verification to succeed");
    expect(verify.data.manifests.find((manifest) => manifest.browserLabel === "ego lite")?.installed).toBe(true);
  });

  test("persists an explicit Chromium user-data target for later verification", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-custom-browser-install-"));
    const userDataDir = join(homeDir, "CustomVendor", "CustomBrowser", "User Data");
    mkdirSync(join(userDataDir, "Default"), { recursive: true });
    writeFileSync(join(userDataDir, "Local State"), "{}\n");
    writeFileSync(join(userDataDir, "Default", "Preferences"), "{}\n");
    const baseOptions = {
      homeDir,
      env: {},
      hostLaunch: { executablePath: "/opt/recallbase/rb", args: [] },
      platform: "darwin" as const,
      healthCheck: () => true,
      macApplicationRoots: []
    };
    const context = {} as Parameters<typeof extensionInstallCommand>[0];

    const install = await extensionInstallCommand(context, ["install-host"], {
      ...baseOptions,
      chromiumUserDataDirs: [userDataDir]
    });
    expect(install.ok).toBe(true);
    if (!install.ok) throw new Error("expected custom Chromium target installation to succeed");
    expect(install.data.manifests.find((manifest) => manifest.browserLabel === "CustomBrowser/User Data (custom)")).toMatchObject({
      installed: true,
      manifestPath: join(userDataDir, "NativeMessagingHosts", "ai.recallbase.extension_host.json")
    });
    expect(JSON.parse(readFileSync(join(homeDir, ".recallbase", "extension-host-targets.json"), "utf8")))
      .toMatchObject({ schemaVersion: 1, userDataDirs: [resolve(userDataDir)] });

    const verify = await extensionInstallCommand(context, ["verify-host"], baseOptions);
    expect(verify.ok).toBe(true);
    if (!verify.ok) throw new Error("expected persisted custom Chromium target verification to succeed");
    expect(verify.data.manifests.some((manifest) => manifest.browserLabel === "CustomBrowser/User Data (custom)" && manifest.installed)).toBe(true);

    const cleared = await extensionInstallCommand(context, ["install-host"], {
      ...baseOptions,
      clearChromiumTargets: true
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) throw new Error("expected saved custom targets to clear");
    expect(cleared.data.manifests.some((manifest) => manifest.browserLabel?.endsWith("(custom)"))).toBe(false);
    expect(JSON.parse(readFileSync(join(homeDir, ".recallbase", "extension-host-targets.json"), "utf8")))
      .toMatchObject({ userDataDirs: [], registryRoots: [] });
  });

  test("rejects invalid or wrong-platform explicit Chromium targets", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-invalid-custom-browser-"));
    const context = {} as Parameters<typeof extensionInstallCommand>[0];
    const common = {
      homeDir,
      env: {},
      hostLaunch: { executablePath: "/opt/recallbase/rb", args: [] },
      healthCheck: () => true
    };

    const invalidDataDir = await extensionInstallCommand(context, ["install-host"], {
      ...common,
      platform: "linux",
      chromiumUserDataDirs: [join(homeDir, "not-a-browser")]
    });
    expect(invalidDataDir.ok).toBe(false);
    if (invalidDataDir.ok) throw new Error("expected invalid Chromium data directory to fail");
    expect(invalidDataDir.error.code).toBe("invalid_arguments");

    const wrongPlatform = await extensionInstallCommand(context, ["verify-host"], {
      ...common,
      platform: "darwin",
      chromiumRegistryRoots: ["HKCU\\Software\\Vendor\\Browser\\NativeMessagingHosts"]
    });
    expect(wrongPlatform.ok).toBe(false);
    if (wrongPlatform.ok) throw new Error("expected Windows registry root on macOS to fail");
    expect(wrongPlatform.error.message).toContain("only supported on Windows");
  });

  test("verify-host returns an error when manifests are missing", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-verify-missing-"));
    const verify = await extensionInstallCommand({} as Parameters<typeof extensionInstallCommand>[0], ["verify-host"], {
      homeDir,
      env: {},
      hostLaunch: { executablePath: "/opt/recallbase/rb", args: [] },
      platform: "darwin",
      healthCheck: () => true
    });

    expect(verify.ok).toBe(false);
    if (verify.ok) throw new Error("expected missing manifests to fail verification");
    expect(verify.error.code).toBe("source_unavailable");
  });

  test("uses Linux browser manifest locations", () => {
    const homeDir = "/home/example";
    const targets = nativeManifestTargets("/home/example/.recallbase/extension-host", {}, {
      homeDir,
      platform: "linux",
      env: {}
    });
    const chromeTarget = targets.find((target) => target.browser === "chrome");
    const chromeForTestingTarget = targets.find((target) => target.browser === "chrome-for-testing");
    const chromiumTarget = targets.find((target) => target.browser === "chromium");
    const edgeTarget = targets.find((target) => target.browser === "edge");
    const firefoxTarget = targets.find((target) => target.browser === "firefox");

    expect(chromeTarget?.manifestPath).toBe("/home/example/.config/google-chrome/NativeMessagingHosts/ai.recallbase.extension_host.json");
    expect(chromeForTestingTarget?.manifestPath).toBe("/home/example/.config/google-chrome-for-testing/NativeMessagingHosts/ai.recallbase.extension_host.json");
    expect(chromiumTarget?.manifestPath).toBe("/home/example/.config/chromium/NativeMessagingHosts/ai.recallbase.extension_host.json");
    expect(edgeTarget?.manifestPath).toBe("/home/example/.config/microsoft-edge/NativeMessagingHosts/ai.recallbase.extension_host.json");
    expect(firefoxTarget?.manifestPath).toBe("/home/example/.mozilla/native-messaging-hosts/ai.recallbase.extension_host.json");
  });

  test("discovers Linux Chromium forks from established profile roots", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "recallbase-linux-browser-discovery-"));
    const configRoot = join(homeDir, ".config");
    mkdirSync(join(configRoot, "BraveSoftware", "Brave-Browser", "Default", "Extensions"), { recursive: true });
    writeFileSync(join(configRoot, "BraveSoftware", "Brave-Browser", "Local State"), "{}\n");
    writeFileSync(join(configRoot, "BraveSoftware", "Brave-Browser", "Default", "Preferences"), "{}\n");
    mkdirSync(join(configRoot, "electron-shell", "Default"), { recursive: true });
    writeFileSync(join(configRoot, "electron-shell", "Local State"), "{}\n");
    writeFileSync(join(configRoot, "electron-shell", "Default", "Preferences"), "{}\n");

    const browsers = discoverLinuxChromiumBrowsers({ roots: [configRoot] });

    expect(browsers).toEqual([{
      label: "BraveSoftware/Brave-Browser",
      dataDir: join(configRoot, "BraveSoftware", "Brave-Browser")
    }]);
    const targets = nativeManifestTargets(join(homeDir, ".recallbase", "extension-host"), {}, {
      homeDir,
      platform: "linux",
      linuxChromiumBrowsers: browsers
    });
    expect(targets.some((target) => target.browserLabel === "BraveSoftware/Brave-Browser"
      && target.manifestPath === join(configRoot, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts", "ai.recallbase.extension_host.json")))
      .toBe(true);
  });

  test("prefers CHROME_CONFIG_HOME over XDG_CONFIG_HOME for built-in Linux Chromium targets", () => {
    const target = nativeManifestTargets("/home/example/.recallbase/extension-host", {}, {
      homeDir: "/home/example",
      env: { CHROME_CONFIG_HOME: "/mnt/chrome", XDG_CONFIG_HOME: "/mnt/xdg" },
      platform: "linux"
    }).find((candidate) => candidate.browser === "chromium" && !candidate.browserLabel);

    expect(target?.manifestPath).toBe("/mnt/chrome/chromium/NativeMessagingHosts/ai.recallbase.extension_host.json");
  });

  test("uses Windows registry-backed manifest locations", () => {
    const homeDir = "C:\\Users\\Example";
    const hostPath = nativeHostWrapperPath(homeDir, "win32");
    const targets = nativeManifestTargets(hostPath, {
      chromeExtensionId: "abcdefghijklmnopabcdefghijklmnop"
    }, {
      homeDir,
      env: { LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" },
      platform: "win32"
    });
    const chromeTarget = targets.find((target) => target.browser === "chrome");
    const chromiumTarget = targets.find((target) => target.browser === "chromium");
    const edgeTarget = targets.find((target) => target.browser === "edge");
    const firefoxTarget = targets.find((target) => target.browser === "firefox");

    expect(hostPath).toBe("C:\\Users\\Example\\.recallbase\\extension-host.exe");
    expect(chromeTarget?.manifestPath).toBe("C:\\Users\\Example\\AppData\\Local\\RecallBase\\NativeMessagingHosts\\ai.recallbase.extension_host.chrome.json");
    expect(chromiumTarget?.registryKey).toBe("HKCU\\Software\\Chromium\\NativeMessagingHosts\\ai.recallbase.extension_host");
    expect(edgeTarget?.manifestPath).toBe("C:\\Users\\Example\\AppData\\Local\\RecallBase\\NativeMessagingHosts\\ai.recallbase.extension_host.edge.json");
    expect(firefoxTarget?.manifestPath).toBe("C:\\Users\\Example\\AppData\\Local\\RecallBase\\NativeMessagingHosts\\ai.recallbase.extension_host.firefox.json");
    expect(nativeHostRegistryKey("chrome")).toBe("HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\ai.recallbase.extension_host");
    expect(nativeHostRegistryKey("chromium")).toBe("HKCU\\Software\\Chromium\\NativeMessagingHosts\\ai.recallbase.extension_host");
    expect(nativeHostRegistryKey("edge")).toBe("HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\ai.recallbase.extension_host");
    expect(nativeHostRegistryKey("firefox")).toBe("HKCU\\Software\\Mozilla\\NativeMessagingHosts\\ai.recallbase.extension_host");
  });

  test("registers discovered Windows native-messaging browser roots", () => {
    const homeDir = "C:\\Users\\Example";
    const registryRoot = "HKCU\\Software\\BraveSoftware\\Brave\\NativeMessagingHosts";
    const targets = nativeManifestTargets("C:\\Users\\Example\\.recallbase\\extension-host.exe", {}, {
      homeDir,
      env: { LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" },
      platform: "win32",
      windowsChromiumRegistryRoots: [registryRoot]
    });

    const brave = targets.find((target) => target.browserLabel === "BraveSoftware/Brave");
    expect(brave?.registryKey).toBe(`${registryRoot}\\ai.recallbase.extension_host`);
    expect(brave?.manifestPath).toBe("C:\\Users\\Example\\AppData\\Local\\RecallBase\\NativeMessagingHosts\\ai.recallbase.extension_host.chromium.json");
  });

  test("extracts a Windows native-messaging root from reg query parent or child keys", () => {
    const expected = "HKCU\\Software\\ExampleBrowser\\Browser\\NativeMessagingHosts";

    expect(windowsNativeMessagingRootFromRegistryLine(
      "HKEY_CURRENT_USER\\Software\\ExampleBrowser\\Browser\\NativeMessagingHosts"
    )).toBe(expected);
    expect(windowsNativeMessagingRootFromRegistryLine(
      "HKEY_CURRENT_USER\\Software\\ExampleBrowser\\Browser\\NativeMessagingHosts\\existing_host"
    )).toBe(expected);
    expect(windowsNativeMessagingRootFromRegistryLine(
      "HKEY_LOCAL_MACHINE\\Software\\ExampleBrowser\\Browser\\NativeMessagingHosts\\existing_host"
    )).toBeUndefined();
  });

  test("accepts a fresh explicit Windows Chromium registry root without prior registration", async () => {
    const registryRoot = "HKCU\\Software\\UnknownVendor\\UnknownBrowser\\NativeMessagingHosts";
    const result = await extensionInstallCommand({} as Parameters<typeof extensionInstallCommand>[0], ["verify-host"], {
      homeDir: "C:\\Users\\Example",
      env: { LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" },
      hostLaunch: { executablePath: "C:\\Users\\Example\\rb.exe", args: [] },
      platform: "win32",
      registry: new MemoryRegistry(),
      healthCheck: () => true,
      chromiumRegistryRoots: [registryRoot],
      targetStorePath: join(mkdtempSync(join(tmpdir(), "recallbase-windows-target-store-")), "targets.json")
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected missing Windows manifests to fail verification");
    const manifests = result.error.details?.manifests as Array<{ browserLabel?: string }>;
    expect(manifests.some((manifest) => manifest.browserLabel === "UnknownVendor/UnknownBrowser")).toBe(true);
  });

  test("keeps cleared Windows custom roots ignored until explicitly re-added", async () => {
    const registryRoot = "HKCU\\Software\\UnknownVendor\\UnknownBrowser\\NativeMessagingHosts";
    const targetStorePath = join(mkdtempSync(join(tmpdir(), "recallbase-ignored-windows-target-")), "targets.json");
    writeFileSync(targetStorePath, `${JSON.stringify({
      schemaVersion: 1,
      userDataDirs: [],
      registryRoots: [],
      ignoredRegistryRoots: [registryRoot]
    })}\n`);
    const registry = new MemoryRegistry();
    registry.nativeMessagingRoots = [registryRoot];
    const common = {
      homeDir: "C:\\Users\\Example",
      env: { LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" },
      hostLaunch: { executablePath: "C:\\Users\\Example\\rb.exe", args: [] },
      platform: "win32" as const,
      registry,
      healthCheck: () => true,
      targetStorePath
    };
    const context = {} as Parameters<typeof extensionInstallCommand>[0];

    const ignored = await extensionInstallCommand(context, ["verify-host"], common);
    expect(ignored.ok).toBe(false);
    if (ignored.ok) throw new Error("expected missing built-in Windows manifests to fail verification");
    const ignoredManifests = ignored.error.details?.manifests as Array<{ browserLabel?: string }>;
    expect(ignoredManifests.some((manifest) => manifest.browserLabel === "UnknownVendor/UnknownBrowser")).toBe(false);

    const restored = await extensionInstallCommand(context, ["verify-host"], {
      ...common,
      chromiumRegistryRoots: [registryRoot]
    });
    expect(restored.ok).toBe(false);
    if (restored.ok) throw new Error("expected missing restored Windows manifest to fail verification");
    const restoredManifests = restored.error.details?.manifests as Array<{ browserLabel?: string }>;
    expect(restoredManifests.some((manifest) => manifest.browserLabel === "UnknownVendor/UnknownBrowser")).toBe(true);
  });

  test("deduplicates discovered Windows roots against built-in registry targets", () => {
    const targets = nativeManifestTargets("C:\\Users\\Example\\.recallbase\\extension-host.exe", {}, {
      homeDir: "C:\\Users\\Example",
      env: { LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" },
      platform: "win32",
      windowsChromiumRegistryRoots: [
        "HKEY_CURRENT_USER\\Software\\Google\\Chrome\\NativeMessagingHosts",
        "HKCU\\Software\\Chromium\\NativeMessagingHosts"
      ]
    });

    expect(targets.filter((target) => target.registryKey?.includes("Google\\Chrome\\NativeMessagingHosts"))).toHaveLength(1);
    expect(targets.filter((target) => target.registryKey?.includes("Software\\Chromium\\NativeMessagingHosts"))).toHaveLength(1);
  });

  test("uses the current macOS Chrome for Testing manifest path", () => {
    const target = nativeManifestTargets("/Users/example/.recallbase/extension-host", {}, {
      homeDir: "/Users/example",
      platform: "darwin"
    }).find((candidate) => candidate.browser === "chrome-for-testing");

    expect(target?.manifestPath).toBe("/Users/example/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/ai.recallbase.extension_host.json");
  });

  test("verifies Windows host copies against the current rb.exe and registry key", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "recallbase-win-host-"));
    const rbPath = join(tempDir, "rb.exe");
    const hostPath = join(tempDir, "extension-host.exe");
    const manifestPath = join(tempDir, "ai.recallbase.extension_host.chrome.json");
    const target = {
      browser: "chrome" as const,
      manifestPath,
      hostName: "ai.recallbase.extension_host",
      binaryPath: hostPath,
      allowedIds: ["abcdefghijklmnopabcdefghijklmnop"],
      installed: false
    };
    const registry = new MemoryRegistry();
    writeFileSync(rbPath, "rb exe bytes");
    writeFileSync(hostPath, "rb exe bytes");
    writeFileSync(manifestPath, `${JSON.stringify(chromeNativeManifest(target), null, 2)}\n`);
    registry.writeDefaultValue(nativeHostRegistryKey("chrome"), manifestPath);

    const hostLaunch = { executablePath: rbPath, args: [] };
    expect(isManifestInstalled(target, hostLaunch, { platform: "win32", registry })).toBe(true);
    writeFileSync(hostPath, "stale exe bytes");
    expect(isManifestInstalled(target, hostLaunch, { platform: "win32", registry })).toBe(false);
  });

  test("Windows install requires a compiled rb.exe", async () => {
    const result = await extensionInstallCommand({} as Parameters<typeof extensionInstallCommand>[0], ["install-host"], {
      homeDir: "C:\\Users\\Example",
      env: {},
      hostLaunch: { executablePath: "C:\\Users\\Example\\rb.ts", args: [] },
      platform: "win32",
      registry: new MemoryRegistry(),
      healthCheck: () => true
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected Windows install to require rb.exe");
    expect(result.error.code).toBe("invalid_arguments");
  });
});
