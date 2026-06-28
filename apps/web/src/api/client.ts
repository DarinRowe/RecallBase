import type { SourceStatus, SyncSearchDocument, SyncStatusResult, SyncedConversationDocument } from "@recallbase/contracts";

export interface WebStatus {
  sync: SyncStatusResult;
  sources: SourceStatus[];
}

export type ConversationDocument = SyncedConversationDocument;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface RecallBaseWebClient {
  status(): Promise<ApiResult<WebStatus>>;
  search(params: { query?: string; sourceId?: string; date?: string; limit?: number }): Promise<ApiResult<{ results: SyncSearchDocument[] }>>;
  conversation(conversationId: string): Promise<ApiResult<ConversationDocument>>;
}

export function createRecallBaseClient(baseUrl = "", token?: string): RecallBaseWebClient {
  const headers = new Headers({ accept: "application/json" });
  if (token) headers.set("authorization", token.startsWith("Bearer ") ? token : `Bearer ${token}`);

  return {
    status: () => requestJson<WebStatus>(apiUrl(baseUrl, "/api/status"), { headers }),
    search: (params) => {
      const url = new URL(apiUrl(baseUrl, "/api/search"), "http://recallbase.local");
      if (params.query) url.searchParams.set("q", params.query);
      if (params.sourceId) url.searchParams.set("sourceId", params.sourceId);
      if (params.date) url.searchParams.set("date", params.date);
      if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
      return requestJson<{ results: SyncSearchDocument[] }>(serializeUrl(url), { headers });
    },
    conversation: (conversationId) =>
      requestJson<ConversationDocument>(apiUrl(baseUrl, `/api/conversations/${encodeURIComponent(conversationId)}`), {
        headers
      })
  };
}

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function serializeUrl(url: URL): string {
  return url.origin === "http://recallbase.local" ? `${url.pathname}${url.search}` : url.toString();
}

async function requestJson<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, credentials: "include" });
  } catch {
    return { ok: false, error: { code: "backend_unavailable", message: "Sync service is unavailable." } };
  }

  const payload = await response.json().catch(() => undefined) as ApiResult<T> | undefined;
  if (payload && typeof payload === "object" && "ok" in payload) return payload;
  return {
    ok: false,
    error: {
      code: response.status === 401 ? "auth_required" : "backend_unavailable",
      message: response.status === 401 ? "Session expired. Continue with Google." : "Sync service returned an unreadable response."
    }
  };
}
