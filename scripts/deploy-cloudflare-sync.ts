import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { encryptConversationChunk, generateDeviceRawKey, importDeviceRawKey } from "../packages/core/src";
import { sha256Hex } from "../apps/cloudflare/src/auth/authorization";

const workerName = process.env.RECALLBASE_CF_WORKER_NAME ?? "recallbase-sync";
const databaseName = process.env.RECALLBASE_CF_D1_NAME ?? "recallbase-sync";
const bucketName = process.env.RECALLBASE_CF_R2_BUCKET ?? "recallbase-raw";
const templateConfigPath = "apps/cloudflare/wrangler.jsonc";

async function main(): Promise<void> {
  const wrangler = await wranglerCommand();
  const databaseId = await ensureD1(wrangler);
  await ensureR2(wrangler);
  await run(["bun", "run", "--cwd", "apps/web", "build"]);
  const configPath = writeDeployConfig(databaseId);
  await run([...wrangler, "d1", "migrations", "apply", databaseName, "--remote", "--config", configPath]);

  const providedToken = process.env.RECALLBASE_SYNC_TOKEN !== undefined;
  const token = process.env.RECALLBASE_SYNC_TOKEN ?? `rb_live_${crypto.randomUUID().replace(/-/g, "")}`;
  const tokenHash = await sha256Hex(token);
  await putSecret(wrangler, configPath, "RECALLBASE_SYNC_TOKEN_SHA256", tokenHash);
  await putOptionalSecret(wrangler, configPath, "GOOGLE_OAUTH_CLIENT_ID", process.env.GOOGLE_OAUTH_CLIENT_ID);
  await putOptionalSecret(wrangler, configPath, "GOOGLE_OAUTH_CLIENT_SECRET", process.env.GOOGLE_OAUTH_CLIENT_SECRET);

  const deployOutput = await runOutput([...wrangler, "deploy", "--config", configPath, "--name", workerName]);
  const url = process.env.RECALLBASE_CF_URL ?? firstWorkersDevUrl(deployOutput);
  if (!url) throw new Error("Could not determine deployed Worker URL. Set RECALLBASE_CF_URL.");

  await runSyncSmoke(url, token);
  console.log(`deployed recallbase sync: ${url}`);
  if (providedToken) {
    console.log("sync token: [provided via RECALLBASE_SYNC_TOKEN]");
  } else {
    const tokenPath = join(process.cwd(), ".recallbase-sync-token");
    writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
    chmodSync(tokenPath, 0o600);
    console.log(`sync token: [generated and written to ${tokenPath}]`);
  }
}

async function ensureD1(wrangler: string[]): Promise<string> {
  const list = await runOutput([...wrangler, "d1", "list"]);
  const existing = parseD1List(list, databaseName);
  if (existing) return existing;
  const created = await runOutput([...wrangler, "d1", "create", databaseName]);
  const id = created.match(/database_id\s*=\s*"([^"]+)"/)?.[1] ?? created.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/)?.[0];
  if (!id) throw new Error(`Could not parse D1 database id from wrangler output:\n${created}`);
  return id;
}

async function ensureR2(wrangler: string[]): Promise<void> {
  const list = await runOutput([...wrangler, "r2", "bucket", "list"]);
  if (list.includes(`name:           ${bucketName}`) || list.includes(bucketName)) return;
  await run([...wrangler, "r2", "bucket", "create", bucketName]);
}

function writeDeployConfig(databaseId: string): string {
  const config = readFileSync(templateConfigPath, "utf8")
    .replaceAll("\"main\": \"src/worker/index.ts\"", `"main": "${resolve("apps/cloudflare/src/worker/index.ts")}"`)
    .replaceAll("\"directory\": \"../web/dist/assets\"", `"directory": "${resolve("apps/web/dist/assets")}"`)
    .replaceAll("__RECALLBASE_D1_DATABASE_ID__", databaseId)
    .replaceAll("\"migrations_dir\": \"migrations\"", `"migrations_dir": "${resolve("apps/cloudflare/migrations")}"`)
    .replaceAll("\"name\": \"recallbase-sync\"", `"name": "${workerName}"`)
    .replaceAll("\"database_name\": \"recallbase-sync\"", `"database_name": "${databaseName}"`)
    .replaceAll("\"bucket_name\": \"recallbase-raw\"", `"bucket_name": "${bucketName}"`);
  const path = join(mkdtempSync(join(tmpdir(), "rb-wrangler-")), "wrangler.jsonc");
  writeFileSync(path, config);
  return path;
}

async function putSecret(wrangler: string[], configPath: string, name: string, value: string): Promise<void> {
  const child = Bun.spawn([...wrangler, "secret", "put", name, "--config", configPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
  });
  child.stdin.write(`${value}\n`);
  child.stdin.end();
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  if (code !== 0) throw new Error(`wrangler secret put failed\n${stdout}\n${stderr}`);
}

async function putOptionalSecret(wrangler: string[], configPath: string, name: string, value: string | undefined): Promise<void> {
  if (!value) {
    console.warn(`${name}: not set; Google OAuth routes will remain unconfigured until this secret is provided.`);
    return;
  }
  await putSecret(wrangler, configPath, name, value);
}

async function runSyncSmoke(syncUrl: string, token: string): Promise<void> {
  const batchId = `deploy_smoke_${Date.now()}`;
  const encryptedConversationChunk = await deploySmokeEncryptedConversationChunk();
  const conversationChunkManifest = manifestForChunks("deploy_smoke_conversation", [encryptedConversationChunk]);
  const response = await fetch(`${syncUrl}/api/sync/batches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      batchId,
      cursor: batchId,
      searchDocuments: [
        {
          id: "deploy_smoke_doc",
          conversationId: "deploy_smoke_conversation",
          sourceId: "codex",
          title: "Production Cloudflare sync smoke",
          updatedAt: "2026-05-21T17:01:00.000Z",
          snippet: "Production Cloudflare sync verification."
        }
      ],
      encryptedConversationChunks: [encryptedConversationChunk],
      conversationChunkManifests: [conversationChunkManifest],
      encryptedRawBlobs: []
    })
  });
  const synced = await response.json() as {
    ok: boolean;
    data?: { uploadedSearchDocuments: number; uploadedEncryptedConversationChunks: number; uploadedEncryptedRawBlobs: number };
  };
  if (
    !response.ok ||
    !synced.ok ||
    synced.data?.uploadedSearchDocuments !== 1 ||
    synced.data.uploadedEncryptedConversationChunks !== 1
  ) {
    throw new Error(`Expected one uploaded search document and encrypted conversation chunk: ${JSON.stringify(synced)}`);
  }
  if (synced.data.uploadedEncryptedRawBlobs !== 0) throw new Error("Hosted smoke uploaded raw evidence.");

  const search = await fetch(`${syncUrl}/api/search?q=production`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await search.json() as { ok: boolean; data?: { results: unknown[] } };
  const results = body.data?.results ?? [];
  const foundSmoke = results.some((item) =>
    item && typeof item === "object" && "title" in item && item.title === "Production Cloudflare sync smoke"
  );
  if (!body.ok || !foundSmoke) throw new Error(`Expected deployed search to return synced smoke document: ${JSON.stringify(body)}`);

  const conversation = await fetch(`${syncUrl}/api/conversations/deploy_smoke_conversation`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const conversationBody = await conversation.json() as { ok: boolean; data?: { encryptedConversationChunks: unknown[] } };
  if (!conversationBody.ok || conversationBody.data?.encryptedConversationChunks.length !== 1) {
    throw new Error(`Expected deployed conversation fetch to return encrypted chunk: ${JSON.stringify(conversationBody)}`);
  }
  if (JSON.stringify(conversationBody.data.encryptedConversationChunks).includes("Hidden production smoke transcript.")) {
    throw new Error("Encrypted conversation chunk leaked plaintext.");
  }
}

function manifestForChunks(conversationId: string, chunks: Awaited<ReturnType<typeof deploySmokeEncryptedConversationChunk>>[]) {
  return {
    conversationId,
    chunks: chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      partIndex: chunk.partIndex,
      partCount: chunk.partCount,
      messageCount: chunk.messageCount,
      keyId: chunk.keyId,
      keyVersion: chunk.keyVersion,
      algorithm: chunk.algorithm,
      contentHashBase64Url: chunk.contentHashBase64Url
    }))
  };
}

async function deploySmokeEncryptedConversationChunk() {
  const deviceKey = await generateDeviceRawKey(new Date("2026-05-21T17:01:00.000Z"));
  const imported = await importDeviceRawKey(deviceKey);
  return encryptConversationChunk(
    {
      conversationId: "deploy_smoke_conversation",
      chunkId: "part_1",
      partIndex: 0,
      partCount: 1,
      messages: [
        {
          id: "deploy_smoke_message",
          role: "assistant",
          createdAt: "2026-05-21T17:01:00.000Z",
          text: "Hidden production smoke transcript."
        }
      ]
    },
    imported,
    new Date("2026-05-21T17:02:00.000Z")
  );
}

async function wranglerCommand(): Promise<string[]> {
  const direct = Bun.spawn(["wrangler", "--version"], { stdout: "pipe", stderr: "pipe" });
  if ((await direct.exited) === 0) return ["wrangler"];
  const bunx = Bun.spawn(["bunx", "wrangler", "--version"], { stdout: "pipe", stderr: "pipe" });
  if ((await bunx.exited) === 0) return ["bunx", "wrangler"];
  throw new Error("wrangler is not available.");
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
  if (code !== 0) throw new Error(`${args.join(" ")} failed\n${stdout}\n${stderr}`);
  return `${stdout}\n${stderr}`;
}

function parseD1List(output: string, name: string): string | undefined {
  const lines = output.split("\n").filter((line) => line.includes(name));
  for (const line of lines) {
    const id = line.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/)?.[0];
    if (id) return id;
  }
  return undefined;
}

function firstWorkersDevUrl(output: string): string | undefined {
  return output.match(/https:\/\/[a-zA-Z0-9.-]+\.workers\.dev/)?.[0];
}

if (!existsSync(templateConfigPath)) throw new Error(`Missing ${templateConfigPath}`);
await main();
