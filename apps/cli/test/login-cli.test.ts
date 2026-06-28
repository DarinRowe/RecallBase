import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../src/cli";

describe("CLI hosted login", () => {
  test("browser handshake polls hosted auth and stores the returned token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-login-cli-"));
    const authPath = join(dir, "auth.json");
    const attemptExpiresAt = futureIso();
    const tokenExpiresAt = futureIso(90 * 24 * 60 * 60 * 1000);
    const originalFetch = globalThis.fetch;
    const originalNoBrowser = process.env.RECALLBASE_NO_BROWSER_OPEN;
    const originalFakeBrowser = process.env.RECALLBASE_FAKE_BROWSER_OPEN;
    process.env.RECALLBASE_FAKE_BROWSER_OPEN = "1";
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/cli/start")) {
        return json({
          ok: true,
          data: {
            state: "opening_browser",
            attemptId: "attempt_1",
            pollToken: "poll_secret_1",
            authorizationUrl: "https://example.test/auth/google/start?state=state_1",
            expiresAt: attemptExpiresAt
          }
        });
      }
      if (url.endsWith("/auth/cli/poll")) {
        return json({
          ok: true,
          data: {
            state: "succeeded",
            accessToken: "rb_live_test_token",
            userId: "user_google",
            deviceId: "device_cli",
            expiresAt: tokenExpiresAt
          }
        });
      }
      throw new Error(url);
    }) as typeof fetch;

    try {
      const result = await runCommand(["login", "--json", "--auth-path", authPath, "--sync-url", "https://example.test"]);
      const body = JSON.parse(result.stdout);
      expect(result.code).toBe(0);
      expect(body.data.state).toBe("succeeded");
      expect(body.data.userId).toBe("user_google");
      expect(statSync(authPath).mode & 0o777).toBe(0o600);
      await expect(Bun.file(authPath).text()).resolves.toContain("rb_live_test_token");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalNoBrowser === undefined) delete process.env.RECALLBASE_NO_BROWSER_OPEN;
      else process.env.RECALLBASE_NO_BROWSER_OPEN = originalNoBrowser;
      if (originalFakeBrowser === undefined) delete process.env.RECALLBASE_FAKE_BROWSER_OPEN;
      else process.env.RECALLBASE_FAKE_BROWSER_OPEN = originalFakeBrowser;
    }
  });

  test("expired login does not write a token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-login-cli-"));
    const authPath = join(dir, "auth.json");
    const attemptExpiresAt = futureIso();
    const originalFetch = globalThis.fetch;
    const originalNoBrowser = process.env.RECALLBASE_NO_BROWSER_OPEN;
    const originalFakeBrowser = process.env.RECALLBASE_FAKE_BROWSER_OPEN;
    process.env.RECALLBASE_FAKE_BROWSER_OPEN = "1";
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/cli/start")) {
        return json({
          ok: true,
          data: {
            state: "opening_browser",
            attemptId: "attempt_1",
            pollToken: "poll_secret_1",
            authorizationUrl: "https://example.test/auth/google/start?state=state_1",
            expiresAt: attemptExpiresAt
          }
        });
      }
      return json({ ok: true, data: { state: "expired" } });
    }) as typeof fetch;

    try {
      const result = await runCommand(["login", "--json", "--auth-path", authPath, "--sync-url", "https://example.test"]);
      const body = JSON.parse(result.stdout);
      expect(result.code).toBe(0);
      expect(body.data.state).toBe("expired");
      expect(existsSync(authPath)).toBeFalse();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalNoBrowser === undefined) delete process.env.RECALLBASE_NO_BROWSER_OPEN;
      else process.env.RECALLBASE_NO_BROWSER_OPEN = originalNoBrowser;
      if (originalFakeBrowser === undefined) delete process.env.RECALLBASE_FAKE_BROWSER_OPEN;
      else process.env.RECALLBASE_FAKE_BROWSER_OPEN = originalFakeBrowser;
    }
  });

  test("malformed succeeded poll does not write a token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-login-cli-"));
    const authPath = join(dir, "auth.json");
    const attemptExpiresAt = futureIso();
    const originalFetch = globalThis.fetch;
    const originalNoBrowser = process.env.RECALLBASE_NO_BROWSER_OPEN;
    const originalFakeBrowser = process.env.RECALLBASE_FAKE_BROWSER_OPEN;
    process.env.RECALLBASE_FAKE_BROWSER_OPEN = "1";
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/cli/start")) {
        return json({
          ok: true,
          data: {
            state: "opening_browser",
            attemptId: "attempt_1",
            pollToken: "poll_secret_1",
            authorizationUrl: "https://example.test/auth/google/start?state=state_1",
            expiresAt: attemptExpiresAt
          }
        });
      }
      return json({ ok: true, data: { state: "succeeded" } });
    }) as typeof fetch;

    try {
      const result = await runCommand(["login", "--json", "--auth-path", authPath, "--sync-url", "https://example.test"]);
      const body = JSON.parse(result.stdout);
      expect(result.code).toBe(0);
      expect(body.data.state).toBe("relogin_required");
      expect(existsSync(authPath)).toBeFalse();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalNoBrowser === undefined) delete process.env.RECALLBASE_NO_BROWSER_OPEN;
      else process.env.RECALLBASE_NO_BROWSER_OPEN = originalNoBrowser;
      if (originalFakeBrowser === undefined) delete process.env.RECALLBASE_FAKE_BROWSER_OPEN;
      else process.env.RECALLBASE_FAKE_BROWSER_OPEN = originalFakeBrowser;
    }
  });

  test("browser launch failure returns copyable URL without polling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rb-login-cli-"));
    const authPath = join(dir, "auth.json");
    const attemptExpiresAt = futureIso();
    const originalFetch = globalThis.fetch;
    const originalNoBrowser = process.env.RECALLBASE_NO_BROWSER_OPEN;
    let pollCalls = 0;
    process.env.RECALLBASE_NO_BROWSER_OPEN = "1";
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/cli/start")) {
        return json({
          ok: true,
          data: {
            state: "opening_browser",
            attemptId: "attempt_1",
            pollToken: "poll_secret_1",
            authorizationUrl: "https://example.test/auth/google/start?state=state_1",
            expiresAt: attemptExpiresAt
          }
        });
      }
      if (url.endsWith("/auth/cli/poll")) pollCalls += 1;
      return json({ ok: true, data: { state: "waiting", expiresAt: attemptExpiresAt } });
    }) as typeof fetch;

    try {
      const result = await runCommand(["login", "--json", "--auth-path", authPath, "--sync-url", "https://example.test"]);
      const body = JSON.parse(result.stdout);
      expect(body.data.state).toBe("browser_launch_failed");
      expect(body.data.authorizationUrl).toContain("/auth/google/start");
      expect(pollCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalNoBrowser === undefined) delete process.env.RECALLBASE_NO_BROWSER_OPEN;
      else process.env.RECALLBASE_NO_BROWSER_OPEN = originalNoBrowser;
    }
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function futureIso(offsetMs = 60_000): string {
  return new Date(Date.now() + offsetMs).toISOString();
}
