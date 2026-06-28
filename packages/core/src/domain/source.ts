export interface SourceDiscovery {
  id: string;
  label: string;
  paths: string[];
  present: boolean;
  schemaFingerprint?: string;
  sourceVersion?: string;
}
