import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_FIREFOX_EXTENSION_ID,
  DEFAULT_CHROME_EXTENSION_ID,
  chromeNativeManifest,
  extensionInstallCommand,
  firefoxNativeManifest,
  isManifestInstalled,
  nativeHostRegistryKey,
  nativeHostWrapperPath,
  nativeManifestTargets,
  resolveHostBinaryPath
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
  test("generates exact Chrome and Firefox allowlists with no wildcards", () => {
    const [chromeTarget, firefoxTarget] = nativeManifestTargets("/Users/example/.recallbase/extension-host", {
      chromeExtensionId: "abcdefghijklmnopabcdefghijklmnop"
    });
    const chromeManifest = chromeNativeManifest(chromeTarget!);
    const firefoxManifest = firefoxNativeManifest(firefoxTarget!);

    expect(chromeManifest.allowed_origins).toEqual(["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"]);
    // Firefox Extension 0.1.1 add-on ID; literal so a regression to .local fails
    expect(firefoxManifest.allowed_extensions).toEqual(["recallbase-capture@recallbase.net"]);
    expect(firefoxTarget?.allowedIds).toEqual(["recallbase-capture@recallbase.net"]);
    expect(DEFAULT_FIREFOX_EXTENSION_ID).toBe("recallbase-capture@recallbase.net");
    expect(chromeManifest.path).toBe("/Users/example/.recallbase/extension-host");
    expect(JSON.stringify(chromeManifest)).not.toContain("*");
    expect(JSON.stringify(firefoxManifest)).not.toContain("*");
  });

  test("uses the stable Chrome extension ID by default", () => {
    const [chromeTarget] = nativeManifestTargets("/Users/example/.recallbase/extension-host");

    expect(chromeTarget?.allowedIds).toEqual([DEFAULT_CHROME_EXTENSION_ID]);
  });

  test("uses the Firefox Extension 0.1.1 add-on ID by default", () => {
    const [, firefoxTarget] = nativeManifestTargets("/Users/example/.recallbase/extension-host");

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
      rbBinaryPath: "/opt/recallbase/rb",
      platform: "darwin"
    });

    expect(install.ok).toBe(true);
    if (!install.ok) throw new Error("expected install to succeed");
    const firefoxManifest = install.data.manifests.find((manifest) => manifest.browser === "firefox");
    expect(firefoxManifest?.allowedIds).toEqual([customFirefoxId]);
    expect(JSON.parse(readFileSync(firefoxManifest!.manifestPath, "utf8")).allowed_extensions).toEqual([customFirefoxId]);
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
    writeFileSync(target.binaryPath, "#!/bin/sh\n");
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

    expect(isManifestInstalled(target, "/new/rb")).toBe(false);
  });

  test("compiled Bun builds install the real executable path, not the virtual bunfs entrypoint", () => {
    expect(resolveHostBinaryPath("/$bunfs/root/cli.js", "/opt/recallbase/rb")).toBe("/opt/recallbase/rb");
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
      rbBinaryPath: "/opt/recallbase/rb",
      platform: "darwin"
    });

    expect(install.ok).toBe(true);
    if (!install.ok) throw new Error("expected install to succeed");
    expect(install.data.manifests.map((manifest) => [manifest.browser, manifest.installed])).toEqual([
      ["chrome", true],
      ["firefox", true]
    ]);
    const wrapperPath = join(homeDir, ".recallbase", "extension-host");
    expect(readFileSync(wrapperPath, "utf8")).toBe("#!/bin/sh\nexec \"/opt/recallbase/rb\" extension-host \"$@\"\n");
    expect(statSync(wrapperPath).mode & 0o111).toBeGreaterThan(0);

    const verify = await extensionInstallCommand(context, ["verify-host"], {
      homeDir,
      env,
      rbBinaryPath: "/opt/recallbase/rb",
      platform: "darwin"
    });

    expect(verify.ok).toBe(true);
    if (!verify.ok) throw new Error("expected verify to succeed");
    expect(verify.data.manifests.every((manifest) => manifest.installed)).toBe(true);
  });

  test("uses Linux browser manifest locations", () => {
    const homeDir = "/home/example";
    const [chromeTarget, firefoxTarget] = nativeManifestTargets("/home/example/.recallbase/extension-host", {}, {
      homeDir,
      platform: "linux"
    });

    expect(chromeTarget?.manifestPath).toBe("/home/example/.config/google-chrome/NativeMessagingHosts/ai.recallbase.extension_host.json");
    expect(firefoxTarget?.manifestPath).toBe("/home/example/.mozilla/native-messaging-hosts/ai.recallbase.extension_host.json");
  });

  test("uses Windows registry-backed manifest locations", () => {
    const homeDir = "C:\\Users\\Example";
    const hostPath = nativeHostWrapperPath(homeDir, "win32");
    const [chromeTarget, firefoxTarget] = nativeManifestTargets(hostPath, {
      chromeExtensionId: "abcdefghijklmnopabcdefghijklmnop"
    }, {
      homeDir,
      env: { LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" },
      platform: "win32"
    });

    expect(hostPath).toBe("C:\\Users\\Example\\.recallbase\\extension-host.exe");
    expect(chromeTarget?.manifestPath).toBe("C:\\Users\\Example\\AppData\\Local\\RecallBase\\NativeMessagingHosts\\ai.recallbase.extension_host.chrome.json");
    expect(firefoxTarget?.manifestPath).toBe("C:\\Users\\Example\\AppData\\Local\\RecallBase\\NativeMessagingHosts\\ai.recallbase.extension_host.firefox.json");
    expect(nativeHostRegistryKey("chrome")).toBe("HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\ai.recallbase.extension_host");
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

    expect(isManifestInstalled(target, rbPath, { platform: "win32", registry })).toBe(true);
    writeFileSync(hostPath, "stale exe bytes");
    expect(isManifestInstalled(target, rbPath, { platform: "win32", registry })).toBe(false);
  });

  test("Windows install requires a compiled rb.exe", async () => {
    const result = await extensionInstallCommand({} as Parameters<typeof extensionInstallCommand>[0], ["install-host"], {
      homeDir: "C:\\Users\\Example",
      env: {},
      rbBinaryPath: "C:\\Users\\Example\\rb.ts",
      platform: "win32",
      registry: new MemoryRegistry()
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected Windows install to require rb.exe");
    expect(result.error.code).toBe("invalid_arguments");
  });
});
