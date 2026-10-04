import { graphRequest, MetaApiError } from "@/lib/meta/client";
import type { MessengerCredentials } from "@/server/messenger/credentials";
import { sendZernioMessage, ZERNIO_BASE } from "@/server/zernio";

/**
 * 017 — Frontera de salida del canal de Messenger (Constitución II: todo
 * request a una plataforma pasa por un único módulo).
 *
 * Dos transportes, misma firma: Zernio (API unificada) y Meta directo. El de
 * Meta habla por `graph.facebook.com`, el MISMO host que WhatsApp, así que
 * reutiliza el cliente de Graph que ya existe (`graphRequest`): misma versión
 * de API, mismo `META_GRAPH_BASE_URL` (y por tanto el mismo mock en pruebas) y
 * los mismos errores tipados que el resto del CRM ya interpreta.
 */

export type MessengerSendResult = { platformMessageId: string };

/**
 * Cuerpo del envío por Meta. Separado para poder afirmarlo en una prueba sin
 * red: la etiqueta de agente humano es lo único que distingue un envío dentro
 * de la ventana de uno fuera, y equivocarla no da error de compilación — da un
 * 400 de Meta en producción a las 2 de la mañana.
 */
export function buildMessengerSendBody(input: {
  recipient: string;
  text: string;
  humanAgentTag: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    recipient: { id: input.recipient },
    message: { text: input.text },
    // RESPONSE dentro de la ventana estándar de 24 h. Fuera, Messenger no
    // la única vía es la etiqueta HUMAN_AGENT (7 días).
    messaging_type: input.humanAgentTag ? "MESSAGE_TAG" : "RESPONSE",
  };
  if (input.humanAgentTag) body.tag = "HUMAN_AGENT";
  return body;
}

export function buildMessengerAttachmentBody(input: {
  recipient: string;
  attachmentType: "image" | "video" | "audio" | "file";
  attachmentId: string;
  humanAgentTag: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    recipient: { id: input.recipient },
    message: {
      attachment: {
        type: input.attachmentType,
        payload: { attachment_id: input.attachmentId },
      },
    },
    messaging_type: input.humanAgentTag ? "MESSAGE_TAG" : "RESPONSE",
  };
  if (input.humanAgentTag) body.tag = "HUMAN_AGENT";
  return body;
}

/**
 * Envía texto por el transporte que corresponda.
 *
 * `recipient` es el PSID (sin el prefijo `fb:`); `threadRef` es el
 * conversationId opaco de Zernio, que solo hace falta en ese transporte.
 */
export async function sendMessengerText(input: {
  credentials: MessengerCredentials;
  recipient: string;
  threadRef: string | null;
  text: string;
  humanAgentTag?: boolean;
  /** Id del mensaje en Vocero: llave natural de idempotencia en Zernio. */
  idempotencyKey?: string;
}): Promise<MessengerSendResult> {
  if (input.credentials.source === "zernio") {
    return sendZernioMessage({
      token: input.credentials.token,
      accountId: input.credentials.accountRef,
      conversationId: input.threadRef,
      text: input.text,
      humanAgentTag: input.humanAgentTag,
      idempotencyKey: input.idempotencyKey,
    });
  }
  return sendViaMeta(input);
}

/** Sube un adjunto reusable y lo envía por Messenger (Meta o Zernio). */
export async function sendMessengerMedia(input: {
  credentials: MessengerCredentials;
  recipient: string;
  threadRef: string | null;
  data: Buffer;
  mimeType: string;
  fileName?: string;
  attachmentType: "image" | "video" | "audio" | "file";
  humanAgentTag: boolean;
}): Promise<MessengerSendResult> {
  if (input.credentials.source === "zernio") {
    if (!input.threadRef) {
      throw new MetaApiError("La conversación no tiene referencia de hilo en Zernio", { status: 400 });
    }
    const form = new FormData();
    form.set("accountId", input.credentials.accountRef ?? "");
    form.set("message", "");
    form.set("attachmentType", input.attachmentType);
    form.set("file", new Blob([new Uint8Array(input.data)], { type: input.mimeType }), input.fileName ?? "archivo");
    let response: Response;
    try {
      response = await fetch(`${ZERNIO_BASE}/inbox/conversations/${encodeURIComponent(input.threadRef)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.credentials.token}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (cause) {
      throw new MetaApiError("No se pudo contactar la API de Zernio", { status: 0, details: cause });
    }
    const text = await response.text();
    type ZernioMediaResponse = { data?: { messageId?: string }; message?: { id?: string }; id?: string };
    let payload: ZernioMediaResponse | null = null;
    try { payload = text ? JSON.parse(text) as ZernioMediaResponse : null; } catch { /* respuesta no JSON */ }
    if (!response.ok) {
      throw new MetaApiError(`Zernio rechazó el adjunto (HTTP ${response.status})`, { status: response.status, details: payload ?? text });
    }
    const id = payload?.data?.messageId ?? payload?.message?.id ?? payload?.id;
    if (!id) throw new MetaApiError("Zernio no devolvió el identificador del adjunto", { status: 502 });
    return { platformMessageId: String(id) };
  }

  if (!input.credentials.pageId) {
    throw new MetaApiError("La conexión de Messenger no tiene ID de página para subir adjuntos", { status: 400 });
  }
  const form = new FormData();
  form.set("message", JSON.stringify({
    attachment: { type: input.attachmentType, payload: { is_reusable: true } },
  }));
  form.set("filedata", new Blob([new Uint8Array(input.data)], { type: input.mimeType }), input.fileName ?? "archivo");
  const upload = await graphRequest<{ attachment_id?: string }>(`${input.credentials.pageId}/message_attachments`, {
    method: "POST",
    token: input.credentials.token,
    body: form,
  });
  if (!upload.attachment_id) {
    throw new MetaApiError("Meta no devolvió el identificador del adjunto", { status: 502 });
  }
  const response = await graphRequest<{ message_id?: string }>(`${input.credentials.pageId}/messages`, {
    method: "POST",
    token: input.credentials.token,
    body: buildMessengerAttachmentBody({
      recipient: input.recipient,
      attachmentType: input.attachmentType,
      attachmentId: upload.attachment_id,
      humanAgentTag: input.humanAgentTag,
    }),
  });
  if (!response.message_id) throw new MetaApiError("Meta no devolvió el identificador del mensaje", { status: 502 });
  return { platformMessageId: String(response.message_id) };
}

/**
 * Meta responde `{ recipient_id, message_id }`; el mock de Graph del entorno
 * de pruebas responde con la forma de WhatsApp (`messages[0].id`), y se
 * aceptan las dos para que el mismo código sirva en ambos.
 */
async function sendViaMeta(input: {
  credentials: MessengerCredentials;
  recipient: string;
  text: string;
  humanAgentTag?: boolean;
}): Promise<MessengerSendResult> {
  const { pageId } = input.credentials;
  if (!pageId) {
    throw new MetaApiError(
      "La conexión de Messenger no tiene ID de página para enviar",
      { status: 400 }
    );
  }
  const res = await graphRequest<{
    message_id?: string;
    messages?: { id: string }[];
  }>(`${pageId}/messages`, {
    method: "POST",
    token: input.credentials.token,
    body: buildMessengerSendBody({
      recipient: input.recipient,
      text: input.text,
      humanAgentTag: input.humanAgentTag ?? false,
    }),
  });
  const id = res.message_id ?? res.messages?.[0]?.id;
  if (!id) {
    throw new MetaApiError("Meta no devolvió ID de mensaje", { status: 502 });
  }
  return { platformMessageId: String(id) };
}

/**
 * Nombre visible de quien escribe. El webhook de Messenger de Meta no trae
 * nombre —solo el PSID—, y un contacto llamado "8371…" en la bandeja es
 * inservible para el operador. Se consulta al perfil con el token de la
 * página; si Meta no lo da (permiso ausente, perfil restringido) se devuelve
 * null y la ingesta cae al nombre de respaldo: nunca se bloquea un mensaje por
 * un nombre. En modo Zernio no hace falta — el evento ya trae el nombre.
 */
export async function fetchMessengerProfileName(
  credentials: MessengerCredentials,
  psid: string
): Promise<string | null> {
  if (credentials.source !== "meta") return null;
  try {
    const res = await graphRequest<{
      first_name?: string;
      last_name?: string;
      name?: string;
    }>(`${psid}?fields=first_name,last_name`, { token: credentials.token });
    const full = [res.first_name, res.last_name]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join(" ")
      .trim();
    return full || res.name?.trim() || null;
  } catch {
    return null;
  }
}
