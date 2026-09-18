/** Diagnostics accept only operational metadata, never provider bodies or user content. */
const allowed = new Set(["httpStatus", "operation", "provider", "requestId", "durationMs", "state"]);
export function diagnosticMetadata(input: Record<string, unknown> = {}) {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    if (typeof value === "boolean") result[key] = value;
    if (typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value)) result[key] = value;
  }
  return result;
}

export function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const value = "code" in error ? error.code : "status" in error ? error.status : undefined;
  // Do not forward arbitrary strings from third-party responses.
  return typeof value === "number" || (typeof value === "string" && /^[A-Z0-9_]{2,30}$/.test(value))
    ? String(value) : "unknown";
}
