import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installer = join(import.meta.dir, "..", "..", "scripts", "install-linux.sh");

describe("Linux installer", () => {
  test("resolves latest and installs a glibc binary after verifying its checksum", async () => {
    const fixture = await makeFixture();
    const result = runInstaller(fixture, {});

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("installed recallbase 0.1.2");
    expect(readFileSync(join(fixture.installDir, "rb"), "utf8")).toContain("recallbase 0.1.2");
  });

  test("stops before installation when the checksum does not match", async () => {
    const fixture = await makeFixture();
    const result = runInstaller(fixture, { RB_VERSION: "0.1.2", FAKE_SHA: "0".repeat(64) });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("checksum mismatch");
  });

  test("rejects musl before downloading an incompatible binary", async () => {
    const fixture = await makeFixture("musl libc");
    const result = runInstaller(fixture, { RB_VERSION: "v0.1.2" });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("musl Linux is not supported");
  });
});

type Fixture = {
  archive: string;
  checksumFile: string;
  checksum: string;
  homeDir: string;
  installDir: string;
  mockBin: string;
};

async function makeFixture(lddOutput = "ldd (GNU libc) 2.39"): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "recallbase-linux-installer-"));
  const payloadDir = join(root, "payload");
  const mockBin = join(root, "bin");
  const homeDir = join(root, "home");
  const installDir = join(root, "installed");
  await Promise.all([
    mkdir(payloadDir),
    mkdir(mockBin),
    mkdir(homeDir),
    mkdir(installDir)
  ]);

  await writeExecutable(join(payloadDir, "rb"), "#!/bin/sh\nprintf 'recallbase 0.1.2\\n'\n");
  const archiveName = "recallbase-x86_64-unknown-linux-gnu-v0.1.2.tar.gz";
  const archive = join(root, archiveName);
  const tarResult = Bun.spawnSync(["tar", "-czf", archive, "-C", payloadDir, "rb"]);
  if (!tarResult.success) throw new Error(tarResult.stderr.toString());
  const checksum = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const checksumFile = join(root, "checksums.sha256");
  await writeFile(checksumFile, `${checksum}  ${archiveName}\n`);

  await writeExecutable(join(mockBin, "uname"), [
    "#!/bin/sh",
    "if [ \"${1:-}\" = \"-s\" ]; then printf 'Linux\\n'; else printf 'x86_64\\n'; fi",
    ""
  ].join("\n"));
  await writeExecutable(join(mockBin, "ldd"), `#!/bin/sh\nprintf '%s\\n' '${lddOutput}'\n`);
  await writeExecutable(join(mockBin, "sha256sum"), "#!/bin/sh\nprintf '%s  %s\\n' \"$FAKE_SHA\" \"$1\"\n");
  await writeExecutable(join(mockBin, "curl"), [
    "#!/bin/sh",
    "destination=''",
    "url=''",
    "while [ \"$#\" -gt 0 ]; do",
    "  case \"$1\" in",
    "    -o|--output) shift; destination=\"$1\" ;;",
    "    http*) url=\"$1\" ;;",
    "  esac",
    "  shift",
    "done",
    "case \"$url\" in",
    "  */releases/latest) printf 'https://github.com/DarinRowe/RecallBase/releases/tag/v0.1.2' ;;",
    "  */checksums.sha256) cp \"$FAKE_CHECKSUM_FILE\" \"$destination\" ;;",
    "  *) cp \"$FAKE_ARCHIVE\" \"$destination\" ;;",
    "esac",
    ""
  ].join("\n"));

  return { archive, checksumFile, checksum, homeDir, installDir, mockBin };
}

function runInstaller(fixture: Fixture, extraEnv: Record<string, string>) {
  return Bun.spawnSync(["bash", installer], {
    env: {
      ...process.env,
      ...extraEnv,
      FAKE_ARCHIVE: fixture.archive,
      FAKE_CHECKSUM_FILE: fixture.checksumFile,
      FAKE_SHA: extraEnv.FAKE_SHA ?? fixture.checksum,
      HOME: fixture.homeDir,
      PATH: `${fixture.mockBin}:${process.env.PATH}`,
      RB_INSTALL_DIR: fixture.installDir,
      RB_NO_MODIFY_PATH: "1"
    }
  });
}

async function writeExecutable(path: string, body: string): Promise<void> {
  await writeFile(path, body);
  chmodSync(path, 0o755);
}
