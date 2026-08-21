import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileSchemaFingerprint } from "../src/common/discovery";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("file schema fingerprint", () => {
  test("depends only on the configured prefix of each file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recallbase-fingerprint-"));
    tempDirs.push(dir);
    const path = join(dir, "source.jsonl");

    await writeFile(path, "ABCD-first-tail");
    const first = await fileSchemaFingerprint([path], 4);
    await writeFile(path, "ABCD-second-tail-that-is-much-larger");
    const changedTail = await fileSchemaFingerprint([path], 4);
    await writeFile(path, "WXYZ-second-tail-that-is-much-larger");
    const changedPrefix = await fileSchemaFingerprint([path], 4);

    expect(changedTail).toBe(first);
    expect(changedPrefix).not.toBe(first);
  });
});
