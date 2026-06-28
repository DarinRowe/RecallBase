import type { SourceStatus } from "@recallbase/contracts";

export function SourceStatusList({ sources }: { sources: SourceStatus[] }) {
  if (sources.length === 0) {
    return (
      <section aria-labelledby="sources-heading" className="panel">
        <h2 id="sources-heading">Sources</h2>
        <p>No synced sources yet. Run <code>rb import</code> and <code>rb sync</code> locally.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="sources-heading" className="panel">
      <h2 id="sources-heading">Sources</h2>
      <ul className="source-list">
        {sources.map((source) => (
          <li key={source.id} className={`source source-${source.health}`}>
            <div>
              <strong>{source.label}</strong>
              <span>{source.health}</span>
            </div>
            <p>
              {source.conversations} conversations, {source.messages} messages
              {source.lastImportAt ? `, last import ${source.lastImportAt}` : ""}
            </p>
            {source.diagnostics.length > 0 ? (
              <p role="status">{source.diagnostics.length} sync or parser warning{source.diagnostics.length === 1 ? "" : "s"}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
