import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_FIREFOX_EXTENSION_ID,
  DEFAULT_CHROME_EXTENSION_ID,
  chromeNativeManifest,
  extensionInstallCommand,
  firefoxNativeManifest,
  isManifestInstalled,
  isNativeHostHealthy,
  nativeHostRegistryKey,
  nativeHostWrapperPath,
  nativeManifestTargets,
  resolveNativeHostLaunch
} from "../src/commands/extension-install";

class MemoryRegistry {
  values = new Map<string, string>();

  writeDefaultValue(key: string, value: string): void {
    this.values.set(key, value);
  }

  readDefaultValue(key: string): string | undefined {
    return this.values.get(key);
  }
}

describe("extension native host install manifests", () => {
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
      platform: "linux"
    });
    const chromeTarget = targets.find((target) => target.browser === "chrome");
    const chromeForTestingTarget = targets.find((target) => target.browser === "chrome-for-testing");
    const edgeTarget = targets.find((target) => target.browser === "edge");
    const firefoxTarget = targets.find((target) => target.browser === "firefox");

    expect(chromeTarget?.manifestPath).toBe("/home/example/.config/google-chrome/NativeMessagingHosts/ai.recallbase.extension_host.json");
    expect(chromeForTestingTarget?.manifestPath).toBe("/home/example/.config/google-chrome-for-testing/NativeMessagingHosts/ai.recallbase.extension_host.json");
    expect(edgeTarget?.manifestPath).toBe("/home/example/.config/microsoft-edge/NativeMessagingHosts/ai.recallbase.extension_host.json");
    expect(firefoxTarget?.manifestPath).toBe("/home/example/.mozilla/native-messaging-hosts/ai.recallbase.extension_host.json");
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
    const edgeTarget = targets.find((target) => target.browser === "edge");
    const firefoxTarget = targets.find((target) => target.browser === "firefox");

    expect(hostPath).toBe("C:\\Users\\Example\\.recallbase\\extension-host.exe");
    expect(chromeTarget?.manifestPath).toBe("C:\\Users\\Example\\AppData\\Local\\RecallBase\\NativeMessagingHosts\\ai.recallbase.extension_host.chrome.json");
    expect(edgeTarget?.manifestPath).toBe("C:\\Users\\Example\\AppData\\Local\\RecallBase\\NativeMessagingHosts\\ai.recallbase.extension_host.edge.json");
    expect(firefoxTarget?.manifestPath).toBe("C:\\Users\\Example\\AppData\\Local\\RecallBase\\NativeMessagingHosts\\ai.recallbase.extension_host.firefox.json");
    expect(nativeHostRegistryKey("chrome")).toBe("HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\ai.recallbase.extension_host");
    expect(nativeHostRegistryKey("edge")).toBe("HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\ai.recallbase.extension_host");
    expect(nativeHostRegistryKey("firefox")).toBe("HKCU\\Software\\Mozilla\\NativeMessagingHosts\\ai.recallbase.extension_host");
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
