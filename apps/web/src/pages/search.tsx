import type { SourceStatus, SyncSearchDocument, SyncStatusResult } from "@recallbase/contracts";
import type { FormEvent } from "react";
import { SearchResults } from "../components/search-results";
import { SourceStatusList } from "../components/source-status";

export type SearchPageState =
  | { state: "loading" }
  | { state: "synced_empty"; sources?: SourceStatus[]; status?: SyncStatusResult; onSearch?: (params: SearchParams) => void }
  | { state: "auth_expired" }
  | { state: "backend_unavailable" }
  | {
      state: "ready";
      query: string;
      sourceId?: string;
      date?: string;
      results: SyncSearchDocument[];
      sources: SourceStatus[];
      status?: SyncStatusResult;
      onSearch?: (params: SearchParams) => void;
    };

interface SearchParams {
  query: string;
  sourceId?: string;
  date?: string;
}

export function SearchPage(props: SearchPageState) {
  if (props.state === "loading") return <main aria-busy="true">Loading synced search...</main>;
  if (props.state === "auth_expired") return <main role="alert">Session expired. Continue with Google.</main>;
  if (props.state === "backend_unavailable") return <main role="alert">Search backend is unavailable.</main>;
  if (props.state === "synced_empty") {
    return (
      <main className="workspace">
        <HeroSearch
          sources={props.sources ?? []}
          {...(props.status ? { status: props.status } : {})}
          {...(props.onSearch ? { onSearch: props.onSearch } : {})}
        />
        <section className="empty-slate">
          <h2>No synced data yet</h2>
          <p>Run <code>rb import</code>, <code>rb login</code>, and <code>rb sync</code> locally.</p>
          <p>Web searches synced metadata, snippets, and optional summaries only. Raw evidence stays local.</p>
        </section>
      </main>
    );
  }

  const partialSources = props.sources.filter((source) => source.health === "partial");

  return (
    <main className="workspace">
      <HeroSearch
        sources={props.sources}
        query={props.query}
        {...(props.status ? { status: props.status } : {})}
        {...(props.sourceId ? { sourceId: props.sourceId } : {})}
        {...(props.date ? { date: props.date } : {})}
        {...(props.onSearch ? { onSearch: props.onSearch } : {})}
      />
      {partialSources.length > 0 ? (
        <p role="status" className="status-note">Some sources are partially synced: {partialSources.map((source) => source.label).join(", ")}</p>
      ) : null}
      <section className="workspace-grid">
        <SearchResults results={props.results} />
        <SourceStatusList sources={props.sources} />
      </section>
    </main>
  );
}

function HeroSearch(props: {
  sources: SourceStatus[];
  status?: SyncStatusResult;
  query?: string;
  sourceId?: string;
  date?: string;
  onSearch?: (params: SearchParams) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sourceId = String(form.get("sourceId") || "");
    const date = String(form.get("date") || "");
    props.onSearch?.({
      query: String(form.get("q") ?? ""),
      ...(sourceId ? { sourceId } : {}),
      ...(date ? { date } : {})
    });
  }

  return (
    <section className="search-command" aria-labelledby="search-heading">
      <div>
        <p className="eyebrow">Hosted sync viewer</p>
        <h1 id="search-heading">Search synced memory</h1>
      </div>
      <div className="signal-strip" aria-label="Sync status">
        <span>{props.status?.lastSyncAt ? `Last sync ${props.status.lastSyncAt}` : "No sync yet"}</span>
        <span>{props.status?.pendingLocalChanges ?? 0} pending local changes</span>
        <span>Raw evidence local-only</span>
      </div>
      <form role="search" aria-label="Search synced RecallBase documents" className="search-form" onSubmit={submit}>
        <label htmlFor="q">Search</label>
        <input id="q" name="q" defaultValue={props.query ?? ""} placeholder="Find a synced conversation" />
        <details>
          <summary>Filters</summary>
          <div className="filters">
            <label htmlFor="source">Source</label>
            <select id="source" name="sourceId" defaultValue={props.sourceId ?? ""}>
              <option value="">All sources</option>
              {props.sources.map((source) => (
                <option key={source.id} value={source.id}>{source.label}</option>
              ))}
            </select>
            <label htmlFor="date">Date</label>
            <input id="date" name="date" type="date" defaultValue={props.date ?? ""} />
          </div>
        </details>
        <button type="submit">Search</button>
      </form>
    </section>
  );
}
