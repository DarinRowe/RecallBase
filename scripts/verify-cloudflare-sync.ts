import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalDatabase } from "../packages/core/src";
import worker from "../apps/cloudflare/src/worker/verification-worker";
import { TEST_TOKEN_USER_A_DEVICE_A } from "../apps/cloudflare/src/sync/routes";
import { runCommand } from "../apps/cli/src/cli";

const configPath = "apps/cloudflare/wrangler.verify.jsonc";

async function main(): Promise<void> {
  const wrangler = await wranglerCommand();
  console.log(`wrangler: ${wrangler.join(" ")}`);
  await run([...wrangler, "deploy", "--dry-run", "--config", configPath]);
  console.log("wrangler dry-run: ok");

  await runInProcessSyncSmoke();
  console.log("in-process sync smoke: ok");

  if (process.env.RECALLBASE_CF_DEPLOY !== "1") {
    console.log("real deploy: skipped (set RECALLBASE_CF_DEPLOY=1 to deploy verification Worker)");
    return;
  }

  const name = `recallbase-sync-verify-${Date.now()}`;
  const deployOutput = await runOutput([...wrangler, "deploy", "--config", configPath, "--name", name]);
  const url = process.env.RECALLBASE_CF_URL ?? firstWorkersDevUrl(deployOutput);
  if (!url) throw new Error("Could not determine deployed Worker URL. Set RECALLBASE_CF_URL.");
  try {
    await runCliSyncAgainst(url);
    console.log(`deployed sync smoke: ok (${url})`);
  } finally {
    await run([...wrangler, "delete", "--name", name, "--force"]).catch((error) => {
      console.warn(`verification cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

async function wranglerCommand(): Promise<string[]> {
  const direct = Bun.spawn(["wrangler", "--version"], { stdout: "pipe", stderr: "pipe" });
  if ((await direct.exited) === 0) return ["wrangler"];

  const bunx = Bun.spawn(["bunx", "wrangler", "--version"], { stdout: "pipe", stderr: "pipe" });
  if ((await bunx.exited) === 0) return ["bunx", "wrangler"];

  throw new Error("wrangler is not available. Install it or ensure bunx can resolve wrangler.");
}

async function run(args: string[]): Promise<void> {
  await runOutput(args);
}

async function runOutput(args: string[]): Promise<string> {
  const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  if (code !== 0) {
    throw new Error(`${args.join(" ")} failed\n${stdout}\n${stderr}`);
  }
  return `${stdout}\n${stderr}`;
}

function firstWorkersDevUrl(output: string): string | undefined {
  return output.match(/https:\/\/[a-zA-Z0-9.-]+\.workers\.dev/)?.[0];
}

async function runInProcessSyncSmoke(): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input, init) => worker.fetch(new Request(input, init))) as typeof fetch;
  try {
    await runCliSyncAgainst("https://recallbase.local");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runCliSyncAgainst(syncUrl: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "rb-cf-sync-"));
  const dbPath = join(dir, "recallbase.sqlite");
  const authPath = join(dir, "auth.json");
  const keyPath = join(dir, "device-key.json");
  const db = new LocalDatabase(dbPath);
  db.importBatch({
    sourceId: "codex",
    sourceLabel: "Codex",
    confidence: "stable",
    confidenceReason: "cloudflare verification fixture",
    conversations: [
      {
        sourceId: "codex",
        sourceLabel: "Codex",
        upstreamId: "cf-sync-smoke",
        title: "Cloudflare sync smoke",
        startedAt: "2026-05-21T16:00:00.000Z",
        updatedAt: "2026-05-21T16:01:00.000Z",
        rawEvidence: [],
        messages: [{ role: "assistant", createdAt: "2026-05-21T16:00:00.000Z", text: "Cloudflare sync verification." }]
      }
    ]
  });
  db.close();

  await assertOk(runCommand(["login", "--json", "--token", TEST_TOKEN_USER_A_DEVICE_A, "--auth-path", authPath]));
  const synced = await assertOk(
    runCommand(["sync", "--json", "--db", dbPath, "--auth-path", authPath, "--device-key-path", keyPath, "--sync-url", syncUrl])
  );
  if (synced.data.uploadedSearchDocuments !== 1) throw new Error("Expected one uploaded search document.");
  if (synced.data.uploadedEncryptedConversationChunks !== 1) {
    throw new Error("Expected one uploaded encrypted conversation chunk.");
  }
  if (synced.data.uploadedEncryptedRawBlobs !== 0) {
    throw new Error("Hosted verification must not upload raw evidence.");
  }

  const response = await fetch(`${syncUrl}/api/search?q=cloudflare`, {
    headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_A}` }
  });
  const body = await response.json() as { ok: boolean; data?: { results: Array<{ conversationId: string }> } };
  if (!body.ok || body.data?.results.length !== 1) throw new Error("Expected deployed search to return the synced document.");

  const conversationId = body.data.results[0]?.conversationId;
  if (!conversationId) throw new Error("Expected search result to include conversation id.");
  const conversation = await fetch(`${syncUrl}/api/conversations/${conversationId}`, {
    headers: { authorization: `Bearer ${TEST_TOKEN_USER_A_DEVICE_A}` }
  });
  const conversationBody = await conversation.json() as {
    ok: boolean;
    data?: { encryptedConversationChunks: unknown[] };
  };
  if (!conversationBody.ok || conversationBody.data?.encryptedConversationChunks.length !== 1) {
    throw new Error("Expected remote conversation fetch to return one encrypted chunk.");
  }
  if (JSON.stringify(conversationBody.data.encryptedConversationChunks).includes("Cloudflare sync verification.")) {
    throw new Error("Encrypted conversation chunk leaked plaintext.");
  }
}

async function assertOk(promise: Promise<{ code: number; stdout: string }>) {
  const result = await promise;
  const body = JSON.parse(result.stdout);
  if (result.code !== 0 || !body.ok) throw new Error(`Command failed: ${result.stdout}`);
  return body;
}

await main();
