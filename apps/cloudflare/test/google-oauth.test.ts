import { describe, expect, test } from "bun:test";
import worker from "../src/worker/index";
import { createMemoryBackend } from "../src/sync/routes";

const identity = JSON.stringify({
  sub: "google-sub-1",
  email: "user@example.com",
  email_verified: true,
  name: "Recall User"
});

const exchange = async () => JSON.parse(identity);

describe("google oauth hosted auth", () => {
  test("google callback completes a CLI login attempt and poll consumes token once", async () => {
    const backend = createMemoryBackend();
    const env = {
      RECALLBASE_BACKEND: backend,
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_EXCHANGE: exchange
    };
    const started = await worker.fetch(new Request("https://example.test/auth/cli/start", {
      method: "POST",
      body: "{}"
    }), env);
    const startedBody = await started.json() as {
      data: { attemptId: string; pollToken: string; authorizationUrl: string };
    };
    const state = new URL(startedBody.data.authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await worker.fetch(new Request(`https://example.test/auth/google/callback?state=${state}&code=ok`), env);
    const firstPoll = await worker.fetch(new Request("https://example.test/auth/cli/poll", {
      method: "POST",
      body: JSON.stringify({ attemptId: startedBody.data.attemptId, pollToken: startedBody.data.pollToken })
    }), env);
    const secondPoll = await worker.fetch(new Request("https://example.test/auth/cli/poll", {
      method: "POST",
      body: JSON.stringify({ attemptId: startedBody.data.attemptId, pollToken: startedBody.data.pollToken })
    }), env);
    const firstPollBody = await firstPoll.json() as { data: { state: string; accessToken?: string; userId?: string } };
    const secondPollBody = await secondPoll.json() as { data: { state: string; accessToken?: string } };

    expect(callback.status).toBe(200);
    expect(firstPollBody.data.state).toBe("succeeded");
    expect(firstPollBody.data.accessToken).toStartWith("rb_live_");
    expect(firstPollBody.data.userId).toStartWith("user_");
    expect(secondPollBody.data.state).toBe("relogin_required");
    expect(secondPollBody.data.accessToken).toBeUndefined();
  });

  test("callback with unknown state fails without creating a session", async () => {
    const response = await worker.fetch(new Request("https://example.test/auth/google/callback?state=missing&code=ok"), {
      RECALLBASE_BACKEND: createMemoryBackend(),
      GOOGLE_OAUTH_CLIENT_ID: "client-id",
      GOOGLE_OAUTH_EXCHANGE: exchange
    });

    expect(response.status).toBe(400);
  });

  test("denied CLI callback updates polling state", async () => {
    const backend = createMemoryBackend();
    const env = { RECALLBASE_BACKEND: backend, GOOGLE_OAUTH_CLIENT_ID: "client-id", GOOGLE_OAUTH_EXCHANGE: exchange };
    const started = await worker.fetch(new Request("https://example.test/auth/cli/start", { method: "POST", body: "{}" }), env);
    const startedBody = await started.json() as { data: { attemptId: string; pollToken: string; authorizationUrl: string } };
    const state = new URL(startedBody.data.authorizationUrl).searchParams.get("state");

    await worker.fetch(new Request(`https://example.test/auth/google/callback?state=${state}&error=access_denied`), env);
    const poll = await worker.fetch(new Request("https://example.test/auth/cli/poll", {
      method: "POST",
      body: JSON.stringify({ attemptId: startedBody.data.attemptId, pollToken: startedBody.data.pollToken })
    }), env);
    const body = await poll.json() as { data: { state: string } };

    expect(body.data.state).toBe("denied");
  });

  test("web session status aggregates synced CLI device state for the same Google user", async () => {
    const backend = createMemoryBackend();
    const env = { RECALLBASE_BACKEND: backend, GOOGLE_OAUTH_CLIENT_ID: "client-id", GOOGLE_OAUTH_EXCHANGE: exchange };
    const cliStart = await worker.fetch(new Request("https://example.test/auth/cli/start", { method: "POST", body: "{}" }), env);
    const cliStartBody = await cliStart.json() as { data: { attemptId: string; pollToken: string; authorizationUrl: string } };
    const cliState = new URL(cliStartBody.data.authorizationUrl).searchParams.get("state");
    await worker.fetch(new Request(`https://example.test/auth/google/callback?state=${cliState}&code=ok`), env);
    const poll = await worker.fetch(new Request("https://example.test/auth/cli/poll", {
      method: "POST",
      body: JSON.stringify({ attemptId: cliStartBody.data.attemptId, pollToken: cliStartBody.data.pollToken })
    }), env);
    const pollBody = await poll.json() as { data: { accessToken: string } };
    await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: { authorization: `Bearer ${pollBody.data.accessToken}` },
      body: JSON.stringify({
        batchId: "batch_status",
        cursor: "cursor-status",
        searchDocuments: [],
        encryptedRawBlobs: [],
        sourceStatuses: [
          {
            id: "codex",
            label: "Codex",
            health: "healthy",
            confidence: "stable",
            confidenceReason: "fixture",
            conversations: 1,
            messages: 1,
            rawEvidence: 0,
            diagnostics: []
          }
        ]
      })
    }), env);
    const secondCliStart = await worker.fetch(new Request("https://example.test/auth/cli/start", { method: "POST", body: "{}" }), env);
    const secondCliStartBody = await secondCliStart.json() as { data: { attemptId: string; pollToken: string; authorizationUrl: string } };
    const secondCliState = new URL(secondCliStartBody.data.authorizationUrl).searchParams.get("state");
    await worker.fetch(new Request(`https://example.test/auth/google/callback?state=${secondCliState}&code=ok`), env);
    const secondPoll = await worker.fetch(new Request("https://example.test/auth/cli/poll", {
      method: "POST",
      body: JSON.stringify({ attemptId: secondCliStartBody.data.attemptId, pollToken: secondCliStartBody.data.pollToken })
    }), env);
    const secondPollBody = await secondPoll.json() as { data: { accessToken: string } };
    await worker.fetch(new Request("https://example.test/api/sync/batches", {
      method: "POST",
      headers: { authorization: `Bearer ${secondPollBody.data.accessToken}` },
      body: JSON.stringify({
        batchId: "batch_status_newer",
        cursor: "cursor-status-newer",
        searchDocuments: [],
        encryptedRawBlobs: [],
        sourceStatuses: [
          {
            id: "codex",
            label: "Codex",
            health: "healthy",
            confidence: "stable",
            confidenceReason: "newer fixture",
            conversations: 2,
            messages: 2,
            rawEvidence: 0,
            diagnostics: []
          }
        ]
      })
    }), env);

    const webStart = await worker.fetch(new Request("https://example.test/auth/google/start"), env);
    const webState = new URL(webStart.headers.get("location")!).searchParams.get("state");
    const callback = await worker.fetch(new Request(`https://example.test/auth/google/callback?state=${webState}&code=ok`), env);
    const cookie = callback.headers.get("set-cookie")!;
    const status = await worker.fetch(new Request("https://example.test/api/status", { headers: { cookie } }), env);
    const statusBody = await status.json() as { data: { sources: Array<{ id: string }>; sync: { remoteCursor?: string } } };

    expect(statusBody.data.sources).toHaveLength(1);
    expect(statusBody.data.sources[0]?.id).toBe("codex");
    expect(statusBody.data.sources[0]?.messages).toBe(2);
    expect(statusBody.data.sync.remoteCursor).toBe("cursor-status-newer");
  });

  test("logout requires same-origin POST", async () => {
    const backend = createMemoryBackend();
    const env = { RECALLBASE_BACKEND: backend };
    const getLogout = await worker.fetch(new Request("https://example.test/auth/logout", {
      headers: { cookie: "rb_session=session_1" }
    }), env);
    const crossOriginPost = await worker.fetch(new Request("https://example.test/auth/logout", {
      method: "POST",
      headers: { cookie: "rb_session=session_1", origin: "https://attacker.test" }
    }), env);
    const sameOriginPost = await worker.fetch(new Request("https://example.test/auth/logout", {
      method: "POST",
      headers: { cookie: "rb_session=session_1", origin: "https://example.test" }
    }), env);

    expect(getLogout.status).toBe(404);
    expect(crossOriginPost.status).toBe(403);
    expect(sameOriginPost.status).toBe(302);
  });

  test("SPA fallback serves assets without swallowing API or auth routes", async () => {
    const assetRequests: string[] = [];
    const env = {
      RECALLBASE_BACKEND: createMemoryBackend(),
      ASSETS: {
        fetch: async (request: Request) => {
          assetRequests.push(new URL(request.url).pathname);
          return new Response("asset", { status: 200 });
        }
      }
    };

    const deepLink = await worker.fetch(new Request("https://example.test/conversation/conv_1"), env);
    const missingApi = await worker.fetch(new Request("https://example.test/api/missing"), env);
    const missingAuth = await worker.fetch(new Request("https://example.test/auth/missing"), env);

    expect(deepLink.status).toBe(200);
    expect(assetRequests).toEqual(["/conversation/conv_1"]);
    expect(missingApi.status).toBe(401);
    expect(missingAuth.status).toBe(404);
  });
});
