const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /sk-[A-Za-z0-9_-]{12,}(?:-[A-Za-z0-9_-]{6,})*/g,
  /sk-proj-[A-Za-z0-9_-]{12,}/g,
  /sk-ant-api\d{2}-[A-Za-z0-9_-]{12,}/g,
  /gh[pousr]_[A-Za-z0-9_]{12,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g
];

export function redactSensitiveText(value: string): string {
  const redacted = SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
  return redacted.replace(
    /((?:api|access|refresh|session|auth)[_-]?token["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
    "$1[REDACTED]"
  );
}

export function redactedLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (/token|secret|body|raw|ciphertext|query|snippet/i.test(key)) {
      output[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      output[key] = redactSensitiveText(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}
