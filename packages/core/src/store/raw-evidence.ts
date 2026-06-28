import type { RawEvidenceInput } from "../batch/conversation";
import { contentHash, stableId } from "./identity";

export interface RawEvidenceRecord extends RawEvidenceInput {
  id: string;
  contentHash: string;
}

export function normalizeRawEvidence(input: RawEvidenceInput): RawEvidenceRecord {
  const hash = contentHash(input.content);
  return {
    ...input,
    id: stableId("raw", [input.sourceId, hash]),
    contentHash: hash
  };
}
