import type { SyncSearchDocument } from "@recallbase/contracts";
import type { AuthSubject } from "../auth/authorization";
import type { ReadableSyncDocument } from "./privacy-schema";

export interface SearchIndexQuery {
  query?: string;
  sourceId?: string;
  date?: string;
  limit?: number;
}

export interface SearchIndex {
  upsert(documents: ReadableSyncDocument[]): Promise<void>;
  search(subject: AuthSubject, query: SearchIndexQuery): Promise<ReadableSyncDocument[]>;
  get(subject: AuthSubject, conversationId: string): Promise<ReadableSyncDocument | undefined>;
}

export class MemorySearchIndex implements SearchIndex {
  private readonly documents = new Map<string, ReadableSyncDocument>();

  async upsert(documents: ReadableSyncDocument[]): Promise<void> {
    for (const document of documents) {
      this.documents.set(`${document.userId}:${document.id}`, document);
    }
  }

  async search(subject: AuthSubject, query: SearchIndexQuery): Promise<ReadableSyncDocument[]> {
    const limit = query.limit ?? 20;
    const terms = query.query?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    return [...this.documents.values()]
      .filter((document) => document.userId === subject.userId && document.completed)
      .filter((document) => !query.sourceId || document.sourceId === query.sourceId)
      .filter((document) => !query.date || document.updatedAt.startsWith(query.date))
      .filter((document) => {
        if (terms.length === 0) return true;
        const haystack = `${document.title} ${document.snippet} ${document.optionalSummary ?? ""}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
  }

  async get(subject: AuthSubject, conversationId: string): Promise<ReadableSyncDocument | undefined> {
    return [...this.documents.values()].find(
      (document) =>
        document.userId === subject.userId &&
        document.completed &&
        document.conversationId === conversationId
    );
  }
}

export function toPublicSearchDocument(document: ReadableSyncDocument): SyncSearchDocument {
  const publicDocument: SyncSearchDocument = {
    id: document.id,
    conversationId: document.conversationId,
    sourceId: document.sourceId,
    title: document.title,
    updatedAt: document.updatedAt,
    snippet: document.snippet
  };
  if (document.optionalSummary !== undefined) publicDocument.optionalSummary = document.optionalSummary;
  return publicDocument;
}
