const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;

export function makeSnippet(text: string, query = "", maxLength = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;

  const terms = [...new Set(queryTerms(query).map((term) => term.toLocaleLowerCase()))];
  const searchable = normalizeSearchText(normalized).toLocaleLowerCase();
  const start = bestSnippetStart(searchable, terms, maxLength);
  const snippet = normalized.slice(start, start + maxLength).trim();
  return `${start > 0 ? "..." : ""}${snippet}${start + maxLength < normalized.length ? "..." : ""}`;
}

export function normalizeSearchLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_SEARCH_LIMIT;
  const integer = Math.floor(value);
  return integer > 0 ? Math.min(integer, MAX_SEARCH_LIMIT) : DEFAULT_SEARCH_LIMIT;
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

function bestSnippetStart(text: string, terms: string[], maxLength: number): number {
  const candidates = new Set([0]);
  for (const term of terms) {
    let index = text.indexOf(term);
    while (index >= 0) {
      candidates.add(Math.max(0, Math.min(index - 60, text.length - maxLength)));
      index = text.indexOf(term, index + Math.max(term.length, 1));
    }
  }

  let bestStart = 0;
  let bestMatches = -1;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const start of candidates) {
    const window = text.slice(start, start + maxLength);
    const positions = terms.map((term) => window.indexOf(term)).filter((index) => index >= 0);
    const matches = positions.length;
    const span = positions.length > 1 ? Math.max(...positions) - Math.min(...positions) : Number.POSITIVE_INFINITY;
    if (matches > bestMatches || (matches === bestMatches && span < bestSpan)) {
      bestStart = start;
      bestMatches = matches;
      bestSpan = span;
    }
  }
  return bestStart;
}
