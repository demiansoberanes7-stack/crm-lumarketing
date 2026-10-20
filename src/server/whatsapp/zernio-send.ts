import { zernioFetch, zernioUploadMediaDirect } from "@/server/zernio";
import { MetaApiError } from "@/lib/meta/client";
import type { WhatsappZernioCredentials } from "./zernio-credentials";
import { zernioWhatsappEnabled } from "./zernio-credentials";

export function zernioMessageId(result: unknown): string {
  const payload = result as { data?: { messageId?: string }; message?: { id?: string }; id?: string } | null;
  const id = payload?.data?.messageId ?? payload?.message?.id ?? payload?.id;
  if (!id) throw new MetaApiError("Zernio no devolvió el identificador del mensaje", { status: 502 });
  return id;
}
/** Límite documentado de Zernio para adjuntos multipart. */
const ZERNIO_MULTIPART_MAX_BYTES = 25 * 1024 * 1024;

export async function sendWhatsappZernio(creds: WhatsappZernioCredentials, thread: string | null, body: Record<string, unknown>, idempotencyKey: string, file?: { data: Buffer; mimeType: string; fileName?: string }) {
  if (!zernioWhatsappEnabled()) throw new MetaApiError("WhatsApp Zernio está desactivado", { status: 409 });
  if (!thread) throw new MetaApiError("Espera un mensaje entrante por Zernio para vincular esta conversación", { status: 409 });
  const endpoint = `/inbox/conversations/${encodeURIComponent(thread)}/messages`;
  if (!file) return zernioMessageId(await zernioFetch(endpoint, { method: "POST", token: creds.token, body: { ...body, accountId: creds.accountId }, headers: { "Idempotency-Key": idempotencyKey } }));
  const attachmentType = String(body.attachmentType ?? "file");
  /**
   * Los documentos salen por multipart: Zernio usa el nombre del archivo
   * subido. Por JSON (attachmentUrl + attachmentName), WhatsApp mostraba un
   * nombre generado por el proveedor en lugar del nombre del cliente.
   * Arriba del límite documentado se conserva la vía JSON.
   */
  if (attachmentType === "file" && file.data.byteLength <= ZERNIO_MULTIPART_MAX_BYTES) {
    const form = new FormData();
    form.set("accountId", creds.accountId);
    if (typeof body.message === "string" && body.message.trim()) form.set("message", body.message);
    form.set(
      "attachment",
      new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
      file.fileName ?? (file.mimeType === "application/pdf" ? "documento.pdf" : "documento")
    );
    return zernioMessageId(await zernioFetch(endpoint, {
      method: "POST",
      token: creds.token,
      formData: form,
      headers: { "Idempotency-Key": idempotencyKey },
    }));
  }
  const uploaded = await zernioUploadMediaDirect({
    token: creds.token,
    data: file.data,
    fileName: file.fileName ?? "archivo",
    mimeType: file.mimeType,
  });
  return zernioMessageId(await zernioFetch(endpoint, {
    method: "POST",
    token: creds.token,
    body: {
      ...body,
      accountId: creds.accountId,
      attachmentUrl: uploaded.url,
      attachmentType,
      ...(attachmentType === "file" ? { attachmentName: file.fileName ?? uploaded.filename } : {}),
    },
    headers: { "Idempotency-Key": idempotencyKey },
  }));
}
