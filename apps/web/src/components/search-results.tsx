import type { SyncSearchDocument } from "@recallbase/contracts";

export function SearchResults({ results }: { results: SyncSearchDocument[] }) {
  if (results.length === 0) {
    return <p role="status">No synced results match this search.</p>;
  }

  return (
    <ol aria-label="Synced search results" className="result-list">
      {results.map((result) => (
        <li key={result.id} className="result-row">
          <a href={`/conversation/${encodeURIComponent(result.conversationId)}`}>{result.title}</a>
          <p>{result.snippet}</p>
          {result.optionalSummary ? <p>{result.optionalSummary}</p> : null}
          <small>
            {result.sourceId} · {result.updatedAt}
          </small>
        </li>
      ))}
    </ol>
  );
}
