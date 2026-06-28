import type { SyncStatusResult } from "@recallbase/contracts";
import type { WebStatus } from "../api/client";
import { SourceStatusList } from "../components/source-status";

export type StatusPageState =
  | { state: "loading" }
  | { state: "auth_expired" }
  | { state: "backend_unavailable" }
  | { state: "ready"; status: WebStatus };

export function StatusPage(props: StatusPageState) {
  if (props.state === "loading") return <main aria-busy="true">Loading synced status...</main>;
  if (props.state === "auth_expired") return <main role="alert">Session expired. Continue with Google.</main>;
  if (props.state === "backend_unavailable") return <main role="alert">Sync service is unavailable. Try again later.</main>;

  return (
    <main>
      <section aria-labelledby="status-heading" className="panel">
        <h1 id="status-heading">RecallBase Sync</h1>
        <PrivacyBoundary status={props.status.sync} />
      </section>
      <SourceStatusList sources={props.status.sources} />
    </main>
  );
}

function PrivacyBoundary({ status }: { status: SyncStatusResult }) {
  if (status.mode === "local_only") {
    return <p>Local-only mode is private to this device. Web cannot see unsynced local history.</p>;
  }

  return (
    <>
      <p>
        Hybrid Private Mode: raw evidence stays local-only. Synced metadata, snippets, and optional summaries are readable here;
        normalized conversation messages sync as encrypted chunks.
      </p>
      <p>
        Full encrypted transcript unlock and raw cloud restore are unavailable in V1
        {status.lastSyncAt ? `; last sync ${status.lastSyncAt}.` : "."}
      </p>
    </>
  );
}
