import { zernioFetch, ZERNIO_BASE } from "@/server/zernio";
import { MetaApiError } from "@/lib/meta/client";
import type { WhatsappZernioCredentials } from "./zernio-credentials";
import { zernioWhatsappEnabled } from "./zernio-credentials";

export function zernioMessageId(result: unknown): string {
  const id = (result as { data?: { messageId?: string } } | null)?.data?.messageId;
  if (!id) throw new MetaApiError("Zernio no devolvió el identificador del mensaje", { status: 502 });
  return id;
}
export async function sendWhatsappZernio(creds: WhatsappZernioCredentials, thread: string | null, body: Record<string, unknown>, idempotencyKey: string, file?: { data: Buffer; mimeType: string; fileName?: string }) {
  if (!zernioWhatsappEnabled()) throw new MetaApiError("WhatsApp Zernio está desactivado", { status: 409 });
  if (!thread) throw new MetaApiError("Espera un mensaje entrante por Zernio para vincular esta conversación", { status: 409 });
  const endpoint = `/inbox/conversations/${encodeURIComponent(thread)}/messages`;
  if (!file) return zernioMessageId(await zernioFetch(endpoint, { method: "POST", token: creds.token, body: { ...body, accountId: creds.accountId }, headers: { "Idempotency-Key": idempotencyKey } }));
  const form = new FormData();
  form.set("accountId", creds.accountId);
  for (const [key, value] of Object.entries(body)) if (value != null) form.set(key, String(value));
  form.set("file", new Blob([new Uint8Array(file.data)], { type: file.mimeType }), file.fileName ?? "archivo");
  let res: Response;
  try { res = await fetch(`${ZERNIO_BASE}${endpoint}`, { method: "POST", headers: { Authorization: `Bearer ${creds.token}`, "Idempotency-Key": idempotencyKey }, body: form, signal: AbortSignal.timeout(60000) }); }
  catch { throw new MetaApiError("No se pudo contactar Zernio", { status: 0 }); }
  if (!res.ok) throw new MetaApiError(`Zernio rechazó el archivo (HTTP ${res.status})`, { status: res.status });
  return zernioMessageId(await res.json());
}
