import type { Diagnostic, DiagnosticSeverity } from "@recallbase/contracts";

export function diagnostic(
  sourceId: string,
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  evidenceRef?: string
): Diagnostic {
  const result: Diagnostic = { sourceId, severity, code, message };
  if (evidenceRef !== undefined) result.evidenceRef = evidenceRef;
  return result;
}

export function malformedJsonlDiagnostic(
  sourceId: string,
  evidenceRef: string,
  error: unknown
): Diagnostic {
  const detail = error instanceof Error ? error.message : "Unknown parse error";
  return diagnostic(sourceId, "error", "jsonl_malformed", `Line is not valid JSON: ${detail}.`, evidenceRef);
}

const SUMMARY_CODES = new Set([
  "claude_code_events_unmapped",
  "claude_code_no_messages",
  "claude_web_no_messages",
  "codex_events_unmapped",
  "codex_no_messages",
  "copilot_no_messages",
  "copilot_no_requests",
  "copilot_response_unmapped",
  "cursor_no_messages",
  "grok_build_no_messages",
  "kimi_code_no_messages",
  "opencode_no_messages",
  "pi_no_messages"
]);

export function summarizeDiagnostics(diagnostics: Diagnostic[] | undefined): Diagnostic[] | undefined {
  if (diagnostics === undefined || diagnostics.length === 0) return diagnostics;

  const grouped = new Map<string, Diagnostic[]>();
  const output: Diagnostic[] = [];
  for (const item of diagnostics) {
    if (!SUMMARY_CODES.has(item.code)) {
      output.push(item);
      continue;
    }
    const key = `${item.sourceId}\u001f${item.severity}\u001f${item.code}`;
    const group = grouped.get(key);
    if (group) {
      group.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }

  for (const group of grouped.values()) {
    output.push(summarizeGroup(group));
  }

  return output;
}

function summarizeGroup(group: Diagnostic[]): Diagnostic {
  if (group.length === 1) return group[0]!;

  const first = group[0]!;
  const skipped = group.reduce((total, item) => total + leadingCount(item.message), 0);
  const skippedText = skipped > 0 ? ` ${skipped} source events or conversations were skipped.` : "";
  const result: Diagnostic = {
    severity: maxSeverity(group),
    code: first.code,
    message: `${group.length} ${first.code} diagnostics were summarized.${skippedText}`
  };
  if (first.sourceId !== undefined) result.sourceId = first.sourceId;
  if (first.evidenceRef !== undefined) result.evidenceRef = first.evidenceRef;
  return result;
}

function leadingCount(message: string): number {
  const match = /^(\d+)\b/.exec(message);
  return match ? Number(match[1]) : 0;
}

function maxSeverity(group: Diagnostic[]): DiagnosticSeverity {
  if (group.some((item) => item.severity === "error")) return "error";
  if (group.some((item) => item.severity === "warning")) return "warning";
  return "info";
}
