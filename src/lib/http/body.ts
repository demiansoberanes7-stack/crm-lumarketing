/** Lee un body sin permitir que una petición pública consuma memoria ilimitada. */
export async function readLimitedBody(
  request: Request,
  maxBytes: number
): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > maxBytes) return null;

  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export function requestClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const lastHop = forwarded?.split(",").map((value) => value.trim()).filter(Boolean).at(-1);
  return request.headers.get("x-real-ip") ?? lastHop ?? "unknown";
}
