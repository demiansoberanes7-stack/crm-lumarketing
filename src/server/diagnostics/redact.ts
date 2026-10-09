/** Diagnostics accept only operational metadata, never provider bodies or user content. */
const allowed = new Set([
  "httpStatus", "status", "operation", "provider", "requestId", "durationMs", "state",
  "taskId", "webhookId", "deliveryId", "accountId", "event", "attempts",
]);

const sensitiveValue = /((?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|token|password|authorization)(\s*[:=]\s*))(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;
const metaToken = /\b(?:EAAB|EAAG|EAAI|EAAA)[A-Za-z0-9]{20,}\b/g;

export function safeDiagnosticText(value: string, maxLength = 3000): string {
  return value
    .replace(sensitiveValue, (_match, keyAndSeparator: string) => `${keyAndSeparator}[redacted]`)
    .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [redacted]")
    .replace(metaToken, "[redacted-meta-token]")
    .replace(/(https?:\/\/[^\s"'<>?]+)\?[^\s"'<>]*/gi, "$1?[redacted-query]")
    .slice(0, maxLength);
}

export function diagnosticMetadata(input: Record<string, unknown> = {}) {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "error" && typeof value === "string") {
      result.errorMessage = safeDiagnosticText(value, 2000);
      continue;
    }
    if (key === "url" && typeof value === "string") {
      try {
        result.endpoint = new URL(value).origin;
      } catch {
        result.endpoint = "URL inválida";
      }
      continue;
    }
    if (!allowed.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    if (typeof value === "boolean") result[key] = value;
    if (typeof value === "string" && /^[a-zA-Z0-9_.:@/-]{1,160}$/.test(value)) result[key] = value;
  }
  return result;
}

const SAFE_ERROR_FIELDS = [
  "name", "message", "code", "status", "statusCode", "type", "error_subcode",
  "fbtrace_id", "requestId", "request_id", "statusText", "operation", "provider",
] as const;

/** Extracts provider/exception diagnostics while dropping headers, tokens and request bodies. */
export function diagnosticError(error: unknown, depth = 0): Record<string, unknown> | null {
  if (error == null || depth > 3) return null;
  if (typeof error === "string") return { message: safeDiagnosticText(error) };
  if (typeof error !== "object") return { message: safeDiagnosticText(String(error)) };

  const source = error as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of SAFE_ERROR_FIELDS) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else if (typeof value === "string" && value.trim()) result[key] = safeDiagnosticText(value, key === "message" ? 3000 : 300);
  }

  if (typeof source.stack === "string") {
    result.stack = safeDiagnosticText(source.stack.split("\n").slice(0, 12).join("\n"), 5000);
  }

  for (const key of ["cause", "error", "details", "response", "data"] as const) {
    const value = source[key];
    if (value == null || value === error) continue;
    if (typeof value === "string") {
      result[key] = safeDiagnosticText(value);
    } else if (typeof value === "object") {
      const nested = diagnosticError(value, depth + 1);
      if (nested && Object.keys(nested).length > 0) result[key] = nested;
    }
  }

  return Object.keys(result).length > 0 ? result : { type: Object.prototype.toString.call(error) };
}

export function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const value = "code" in error ? error.code : "status" in error ? error.status : "statusCode" in error ? error.statusCode : undefined;
  // Do not forward arbitrary strings from third-party responses.
  return typeof value === "number" || (typeof value === "string" && /^[A-Z0-9_]{2,30}$/.test(value))
    ? String(value) : "unknown";
}
