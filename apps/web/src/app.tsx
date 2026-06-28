import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SourceStatus, SyncSearchDocument, SyncedConversationDocument } from "@recallbase/contracts";
import { createRecallBaseClient, type WebStatus } from "./api/client";
import { ConversationPage } from "./pages/conversation";
import { LoginPage } from "./pages/login";
import { SearchPage } from "./pages/search";

type AppState =
  | { state: "loading" }
  | { state: "auth_expired" }
  | { state: "backend_unavailable" }
  | { state: "ready"; status: WebStatus; query: string; sourceId?: string; date?: string; results: SyncSearchDocument[] }
  | { state: "conversation"; status?: WebStatus; conversation: SyncedConversationDocument }
  | { state: "not_found" };

export function RecallBaseApp() {
  const client = useMemo(() => createRecallBaseClient(), []);
  const [appState, setAppState] = useState<AppState>({ state: "loading" });

  useEffect(() => {
    void loadRoute();
  }, []);

  async function loadRoute() {
    const path = window.location.pathname;
    if (path === "/login") {
      setAppState({ state: "auth_expired" });
      return;
    }
    if (path.startsWith("/conversation/")) {
      const conversationId = decodeURIComponent(path.slice("/conversation/".length));
      const [status, conversation] = await Promise.all([client.status(), client.conversation(conversationId)]);
      if (!conversation.ok) {
        setAppState(conversation.error.code === "auth_required" ? { state: "auth_expired" } : { state: "not_found" });
        return;
      }
      setAppState({
        state: "conversation",
        conversation: conversation.data,
        ...(status.ok ? { status: status.data } : {})
      });
      return;
    }
    await runSearch(new URLSearchParams(window.location.search));
  }

  async function runSearch(params: URLSearchParams) {
    setAppState({ state: "loading" });
    const query = params.get("q") ?? "";
    const sourceId = params.get("sourceId") || undefined;
    const date = params.get("date") || undefined;
    const [status, search] = await Promise.all([
      client.status(),
      client.search({
        query,
        limit: 30,
        ...(sourceId ? { sourceId } : {}),
        ...(date ? { date } : {})
      })
    ]);
    if (!status.ok || !search.ok) {
      const error = !status.ok ? status.error : search.ok ? undefined : search.error;
      setAppState(error?.code === "auth_required" ? { state: "auth_expired" } : { state: "backend_unavailable" });
      return;
    }
    setAppState({
      state: "ready",
      status: status.data,
      query,
      results: search.data.results,
      ...(sourceId ? { sourceId } : {}),
      ...(date ? { date } : {})
    });
  }

  function submitSearch(params: { query: string; sourceId?: string; date?: string }) {
    const search = new URLSearchParams();
    if (params.query.trim()) search.set("q", params.query.trim());
    if (params.sourceId) search.set("sourceId", params.sourceId);
    if (params.date) search.set("date", params.date);
    const next = `/search${search.toString() ? `?${search}` : ""}`;
    window.history.pushState({}, "", next);
    void runSearch(search);
  }

  if (appState.state === "loading") return <SearchPage state="loading" />;
  if (appState.state === "auth_expired") return <LoginPage state="expired" />;
  if (appState.state === "backend_unavailable") return <LoginPage state="backend_unavailable" />;
  if (appState.state === "not_found") return <ConversationPage state="not_found" />;

  if (appState.state === "conversation") {
    return (
      <AppChrome sources={appState.status?.sources ?? []}>
        <ConversationPage
          state="ready"
          document={appState.conversation.document}
          encryptedConversationChunks={appState.conversation.encryptedConversationChunks}
          {...(appState.conversation.lockedEncryptedConversationChunks
            ? { lockedEncryptedConversationChunks: appState.conversation.lockedEncryptedConversationChunks }
            : {})}
        />
      </AppChrome>
    );
  }

  const hasSyncedData = appState.status.sources.length > 0 || appState.results.length > 0 || appState.query.length > 0;
  return (
    <AppChrome sources={appState.status.sources}>
      {hasSyncedData ? (
        <SearchPage
          state="ready"
          query={appState.query}
          results={appState.results}
          sources={appState.status.sources}
          status={appState.status.sync}
          onSearch={submitSearch}
          {...(appState.sourceId ? { sourceId: appState.sourceId } : {})}
          {...(appState.date ? { date: appState.date } : {})}
        />
      ) : (
        <SearchPage
          state="synced_empty"
          sources={appState.status.sources}
          status={appState.status.sync}
          onSearch={submitSearch}
        />
      )}
    </AppChrome>
  );
}

function AppChrome({ children, sources }: { children: ReactNode; sources: SourceStatus[] }) {
  return (
    <>
      <header className="top-bar">
        <a className="brand" href="/">
          <img src="/brand/recallbase-logo-mark.png" alt="" />
          <span>RecallBase</span>
        </a>
        <div className="top-meta">{sources.length} synced source{sources.length === 1 ? "" : "s"}</div>
        <form method="post" action="/auth/logout" className="logout-form">
          <button className="logout" type="submit">Logout</button>
        </form>
      </header>
      {children}
    </>
  );
}
