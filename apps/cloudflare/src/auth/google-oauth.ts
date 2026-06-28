import type { LoginResult } from "@recallbase/contracts";
import { createBrowserLoginUrl } from "./browser-login";
import type { GoogleIdentity, HostedAuthStore } from "./session-store";

export interface GoogleOAuthEnv {
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  RECALLBASE_HOSTED_BASE_URL?: string;
  GOOGLE_OAUTH_EXCHANGE?: (code: string, baseUrl: string) => Promise<GoogleIdentity>;
}

export async function handleAuthRoute(
  request: Request,
  env: GoogleOAuthEnv,
  authStore: HostedAuthStore
): Promise<Response | undefined> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/auth/cli/start") {
    const body = await readJsonRecord(request);
    const baseUrl = hostedBaseUrl(env, url);
    const placeholder = googleAuthorizationUrl(env, baseUrl, "pending");
    const attempt = await authStore.createCliLoginAttempt({
      authorizationUrl: placeholder,
      ...(typeof body.deviceName === "string" ? { deviceName: body.deviceName } : {})
    });
    const authorizationUrl = googleAuthorizationUrl(env, baseUrl, attempt.oauthState);
    return json({
      ok: true,
      data: {
        state: "opening_browser",
        attemptId: attempt.attemptId,
        pollToken: attempt.pollToken,
        authorizationUrl,
        expiresAt: attempt.expiresAt
      }
    });
  }

  if (request.method === "POST" && url.pathname === "/auth/cli/poll") {
    const body = await readJsonRecord(request);
    if (typeof body.attemptId !== "string" || typeof body.pollToken !== "string") {
      return json({ ok: false, error: { code: "invalid_arguments", message: "attemptId and pollToken are required." } }, 400);
    }
    const result = await authStore.pollCliLoginAttempt(body.attemptId, body.pollToken);
    return json({ ok: true, data: result });
  }

  if (request.method === "GET" && url.pathname === "/auth/google/start") {
    const baseUrl = hostedBaseUrl(env, url);
    const state = await authStore.createWebOAuthState();
    return redirect(googleAuthorizationUrl(env, baseUrl, state.oauthState));
  }

  if (request.method === "GET" && url.pathname === "/auth/google/callback") {
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    if (url.searchParams.get("error")) {
      if (state) await authStore.cancelCliLoginAttempt(state, "denied");
      return authHtml("Login denied", "Google login was denied.", 403);
    }
    if (!state || !code) {
      if (state) await authStore.cancelCliLoginAttempt(state, "cancelled");
      return authHtml("Login cancelled", "Google did not return an authorization code.", 400);
    }

    let identity: GoogleIdentity;
    try {
      identity = await exchangeGoogleIdentity(code, env, hostedBaseUrl(env, url));
    } catch {
      return authHtml("Login failed", "Google login could not be verified.", 400);
    }

    const cliResult = await authStore.completeCliLoginAttempt(state, identity);
    if (cliResult === "completed") {
      return authHtml("RecallBase login complete", "Return to your terminal to finish rb login.", 200);
    }
    const webSession = await authStore.completeWebLogin(state, identity);
    if (!webSession) return authHtml("Login expired", "Start Google login again.", 400);
    const headers = new Headers({
      location: "/",
      "cache-control": "no-store"
    });
    headers.set("set-cookie", sessionCookie(webSession.sessionId, webSession.expiresAt));
    return new Response(null, { status: 302, headers });
  }

  if (request.method === "POST" && url.pathname === "/auth/logout") {
    if (!isSameOrigin(request, url)) {
      return json({ ok: false, error: { code: "auth_required", message: "Logout requires a same-origin request." } }, 403);
    }
    const session = readCookie(request, "rb_session");
    if (session) await authStore.revokeWebSession(session);
    const headers = new Headers({ location: "/login", "cache-control": "no-store" });
    headers.set("set-cookie", "rb_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
    return new Response(null, { status: 302, headers });
  }

  return undefined;
}

export function googleAuthorizationUrl(env: GoogleOAuthEnv, baseUrl: string, state: string): string {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) return `${baseUrl}/login?auth=unconfigured`;
  return createBrowserLoginUrl({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    redirectUri: `${baseUrl}/auth/google/callback`,
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    state,
    scope: "openid email profile"
  }).authorizationUrl!;
}

export async function exchangeGoogleIdentity(code: string, env: GoogleOAuthEnv, baseUrl: string): Promise<GoogleIdentity> {
  if (env.GOOGLE_OAUTH_EXCHANGE) return normalizeIdentity(await env.GOOGLE_OAUTH_EXCHANGE(code, baseUrl));
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error("Google OAuth is not configured.");
  }

  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${baseUrl}/auth/google/callback`
    })
  });
  const tokenBody = await token.json().catch(() => undefined) as { access_token?: string } | undefined;
  if (!token.ok || !tokenBody?.access_token) throw new Error("Google token exchange failed.");

  const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokenBody.access_token}` }
  });
  if (!profile.ok) throw new Error("Google identity fetch failed.");
  return normalizeIdentity(await profile.json());
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, value] = part.trim().split("=");
    if (key === name && value) return decodeURIComponent(value);
  }
  return undefined;
}

function normalizeIdentity(value: unknown): GoogleIdentity {
  if (!isRecord(value) || typeof value.sub !== "string" || value.sub.length === 0) {
    throw new Error("Google identity response is missing subject.");
  }
  return {
    sub: value.sub,
    ...(typeof value.email === "string" ? { email: value.email } : {}),
    ...(typeof value.email_verified === "boolean" ? { emailVerified: value.email_verified } : {}),
    ...(typeof value.emailVerified === "boolean" ? { emailVerified: value.emailVerified } : {}),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.picture === "string" ? { picture: value.picture } : {})
  };
}

function hostedBaseUrl(env: GoogleOAuthEnv, url: URL): string {
  return (env.RECALLBASE_HOSTED_BASE_URL ?? url.origin).replace(/\/$/, "");
}

function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  return origin === url.origin;
}

function sessionCookie(sessionId: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return `rb_session=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
}

function authHtml(title: string, message: string, status: number): Response {
  return new Response(`<!doctype html><title>${escapeHtml(title)}</title><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function readJsonRecord(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => ({}));
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]!));
}
