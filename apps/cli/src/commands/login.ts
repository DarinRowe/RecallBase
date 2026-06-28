import { err, ok, type LoginResult, type ResultEnvelope } from "@recallbase/contracts";
import type { CliFlags } from "../config";
import { FileTokenStore } from "../auth/token-store";

const DEFAULT_HOSTED_URL = "https://recallbase.app";

interface LoginContext {
  flags: CliFlags;
}

export async function loginCommand(context: LoginContext): Promise<ResultEnvelope<LoginResult>> {
  if (context.flags.token) {
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    try {
      new FileTokenStore(context.flags.authPath || undefined).write({
        accessToken: context.flags.token,
        userId: "unknown",
        expiresAt
      });
    } catch {
      return ok("login", { state: "token_storage_failed" });
    }
    return ok("login", {
      state: "succeeded",
      expiresAt
    });
  }

  const syncUrl = (context.flags.syncUrl ?? DEFAULT_HOSTED_URL).replace(/\/$/, "");
  const started = await startHostedLogin(syncUrl);
  if (!started.ok) {
    return err("login", {
      code: "auth_failed",
      message: started.message,
      hint: "Check RECALLBASE_SYNC_URL or pass --sync-url for your hosted RecallBase Worker."
    });
  }

  const browserOpened = await openSystemBrowser(started.data.authorizationUrl);
  if (!browserOpened) {
    return ok("login", {
      state: "browser_launch_failed",
      authorizationUrl: started.data.authorizationUrl,
      attemptId: started.data.attemptId,
      expiresAt: started.data.expiresAt
    });
  }

  const completed = await pollHostedLogin(syncUrl, started.data.attemptId, started.data.pollToken, started.data.expiresAt);
  if (completed.state !== "succeeded") {
    return ok("login", {
      state: browserOpened ? completed.state : "browser_launch_failed",
      authorizationUrl: started.data.authorizationUrl,
      attemptId: started.data.attemptId,
      expiresAt: started.data.expiresAt
    });
  }

  try {
    new FileTokenStore(context.flags.authPath || undefined).write({
      accessToken: completed.accessToken,
      userId: completed.userId,
      expiresAt: completed.expiresAt
    });
  } catch {
    return ok("login", { state: "token_storage_failed" });
  }

  return ok("login", {
    state: "succeeded",
    userId: completed.userId,
    expiresAt: completed.expiresAt
  });
}

interface LoginStartData {
  state: "opening_browser";
  attemptId: string;
  pollToken: string;
  authorizationUrl: string;
  expiresAt: string;
}

type LoginStartResult = { ok: true; data: LoginStartData } | { ok: false; message: string };

async function startHostedLogin(syncUrl: string): Promise<LoginStartResult> {
  const response = await fetch(`${syncUrl}/auth/cli/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client: "rb" })
  }).catch(() => undefined);
  if (!response) return { ok: false, message: "Hosted login service is unavailable." };
  const payload = await response.json().catch(() => undefined) as { ok?: boolean; data?: Partial<LoginStartData>; error?: { message?: string } } | undefined;
  if (!response.ok || !payload?.ok || !payload.data) {
    return { ok: false, message: payload?.error?.message ?? `Hosted login failed with HTTP ${response.status}.` };
  }
  const data = payload.data;
  if (
    data.state !== "opening_browser" ||
    typeof data.attemptId !== "string" ||
    typeof data.pollToken !== "string" ||
    typeof data.authorizationUrl !== "string" ||
    typeof data.expiresAt !== "string"
  ) {
    return { ok: false, message: "Hosted login returned an unsupported response." };
  }
  return { ok: true, data: data as LoginStartData };
}

type HostedPollResult =
  | { state: "waiting"; expiresAt: string }
  | { state: "expired" | "denied" | "cancelled" | "relogin_required" | "timeout" }
  | { state: "succeeded"; accessToken: string; userId: string; expiresAt: string };

async function pollHostedLogin(syncUrl: string, attemptId: string, pollToken: string, expiresAt: string): Promise<HostedPollResult> {
  const parsedDeadline = Date.parse(expiresAt);
  const deadline = Number.isFinite(parsedDeadline) ? parsedDeadline : Date.now() + 60_000;
  let delayMs = 250;
  while (Date.now() < deadline) {
    const response = await fetch(`${syncUrl}/auth/cli/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attemptId, pollToken })
    }).catch(() => undefined);
    if (!response) return { state: "relogin_required" };
    const payload = await response.json().catch(() => undefined) as { ok?: boolean; data?: unknown } | undefined;
    if (!response.ok || !payload?.ok || !payload.data) return { state: "relogin_required" };
    const parsed = parseHostedPollResult(payload.data);
    if (!parsed) return { state: "relogin_required" };
    if (parsed.state !== "waiting") return parsed;
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 1.5, 1500);
  }
  return { state: "timeout" };
}

function parseHostedPollResult(value: unknown): HostedPollResult | undefined {
  if (!isRecord(value) || typeof value.state !== "string") return undefined;
  if (value.state === "waiting" && typeof value.expiresAt === "string") return { state: "waiting", expiresAt: value.expiresAt };
  if (
    value.state === "expired" ||
    value.state === "denied" ||
    value.state === "cancelled" ||
    value.state === "relogin_required" ||
    value.state === "timeout"
  ) {
    return { state: value.state };
  }
  if (
    value.state === "succeeded" &&
    typeof value.accessToken === "string" &&
    typeof value.userId === "string" &&
    typeof value.expiresAt === "string"
  ) {
    return { state: "succeeded", accessToken: value.accessToken, userId: value.userId, expiresAt: value.expiresAt };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function openSystemBrowser(url: string): Promise<boolean> {
  if (process.env.RECALLBASE_FAKE_BROWSER_OPEN === "1") return true;
  if (process.env.RECALLBASE_NO_BROWSER_OPEN === "1") return false;
  const command = process.platform === "darwin"
    ? ["open", url]
    : process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url];
  try {
    const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    return (await child.exited) === 0;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
