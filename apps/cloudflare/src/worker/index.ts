import { createCloudflareBackend, type CloudflareBackendEnv } from "../sync/cloudflare-backend";
import { handleSyncRoute, type SyncBackend } from "../sync/routes";
import { handleAuthRoute, type GoogleOAuthEnv } from "../auth/google-oauth";

export interface WorkerEnv extends Partial<CloudflareBackendEnv>, GoogleOAuthEnv {
  RECALLBASE_BACKEND?: SyncBackend;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: WorkerEnv = {}): Promise<Response> {
    const backend = env.RECALLBASE_BACKEND ?? backendFromEnv(env);
    if (!backend) {
      return withSecurityHeaders(
        new Response(JSON.stringify({ ok: false, error: { code: "sync_failed", message: "Persistent sync backend is not configured." } }), {
          status: 503,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
        })
      );
    }
    if (backend.authStore) {
      const auth = await handleAuthRoute(request, env, backend.authStore);
      if (auth) return withSecurityHeaders(auth);
    }
    if (new URL(request.url).pathname.startsWith("/auth/")) {
      return withSecurityHeaders(new Response("Not found", { status: 404 }));
    }
    if (new URL(request.url).pathname.startsWith("/api/")) {
      const routed = await handleSyncRoute(request, backend);
      if (routed) return withSecurityHeaders(routed);
    }
    return withSecurityHeaders(await spaFallback(request, env));
  }
};

function backendFromEnv(env: WorkerEnv): SyncBackend | undefined {
  if (!env.SYNC_DB || !env.RAW_BUCKET) return undefined;
  return createCloudflareBackend(env as CloudflareBackendEnv);
}

async function spaFallback(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return new Response("Not found", { status: 404 });
  }
  if (env.ASSETS) return env.ASSETS.fetch(request);
  return new Response("Not found", { status: 404 });
}

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set(
    "content-security-policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'"
  );
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
