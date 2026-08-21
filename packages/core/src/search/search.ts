export function makeSnippet(text: string, query = "", maxLength = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;

  const term = query.trim().split(/\s+/)[0]?.toLowerCase();
  const index = term ? normalized.toLowerCase().indexOf(term) : -1;
  const start = Math.max(0, index > 0 ? index - 60 : 0);
  const snippet = normalized.slice(start, start + maxLength).trim();
  return `${start > 0 ? "..." : ""}${snippet}${start + maxLength < normalized.length ? "..." : ""}`;
}

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC");
}

export function toFtsQuery(query: string): string | undefined {
  const terms = queryTerms(query);
  if (terms.length === 0) return undefined;
  return terms.map(quoteFtsTerm).join(" AND ");
}

export function queryTerms(query: string): string[] {
  return normalizeSearchText(query).trim().split(/\s+/u).filter(Boolean);
}

function quoteFtsTerm(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}
