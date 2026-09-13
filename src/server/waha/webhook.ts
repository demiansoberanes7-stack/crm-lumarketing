/**
 * WAHA Webhook handler — procesa eventos entrantes de WAHA.
 *
 * WAHA envía eventos de mensajes, estados de entrega y estado de sesión.
 * Este handler los procesa y los enruta al sistema de ingesta de Vocero.
 *
 * Eventos soportados:
 * - message.any: mensajes entrantes + echoes
 * - message.ack: actualizaciones de estado (sent/delivered/read)
 * - session.status: estado de la sesión WAHA
 */
import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import { applyStatusUpdate } from "@/server/inbox/status";
import { publish } from "@/server/events/bus";
import { normalizeMx } from "@/lib/meta/client";
import type { Channel } from "@/lib/channels";
import { safeEqual } from "@/server/inbox/webhook";
import { wahaWebhookToken } from "./webhook-token";
import { whatsappProvider } from "@/server/whatsapp/provider";

export type WahaWebhookEvent = {
  event: string;
  session: string;
  payload: Record<string, unknown>;
};

/** Verificar firma HMAC del webhook (opcional) */
/**
 * Convertir mensaje de WAHA al formato interno de Vocero.
 * WAHA usa formato similar a WhatsApp Web: { key: { remoteJid, fromMe, id }, message, messageTimestamp }
 */
function normalizeWahaMessage(payload: Record<string, unknown>) {
  const key = payload.key as Record<string, unknown> | undefined;
  const message = payload.message as Record<string, unknown> | undefined;
  const pushName = payload.pushName as string | undefined;

  const fromMe = payload.fromMe === true || key?.fromMe === true;
  const remoteJid = (key?.remoteJid as string) ?? (fromMe ? payload.to : payload.from) as string ?? "";
  const id = (payload.id as string) ?? (key?.id as string) ?? "";

  // Extraer tipo y contenido del mensaje
  let type = "text";
  let text: string | null = typeof payload.body === "string" ? payload.body : null;
  let media: Record<string, unknown> | null = null;

  if (message) {
    if (message.conversation) {
      type = "text";
      text = message.conversation as string;
    } else if (message.extendedTextMessage) {
      type = "text";
      const ext = message.extendedTextMessage as Record<string, unknown>;
      text = (ext.text as string) ?? null;
    } else if (message.imageMessage) {
      type = "image";
      media = message.imageMessage as Record<string, unknown>;
      text = (media.caption as string) ?? null;
    } else if (message.videoMessage) {
      type = "video";
      media = message.videoMessage as Record<string, unknown>;
      text = (media.caption as string) ?? null;
    } else if (message.audioMessage) {
      type = "audio";
      media = message.audioMessage as Record<string, unknown>;
    } else if (message.documentMessage) {
      type = "document";
      media = message.documentMessage as Record<string, unknown>;
      text = (media.caption as string) ?? null;
    } else if (message.stickerMessage) {
      type = "sticker";
      media = message.stickerMessage as Record<string, unknown>;
    }
  }

  // Normalizar chatId: remover sufijo @s.whatsapp.net / @g.us
  const phone = remoteJid.replace(/@.*$/, "");

  return {
    id,
    phone: /@(g\.us|broadcast|lid)$/.test(remoteJid) || !/^\d+$/.test(phone) ? "" : phone,
    pushName,
    fromMe,
    type,
    text,
    media,
    timestamp: (payload.timestamp as number) ?? (payload.messageTimestamp as number) ?? Math.floor(Date.now() / 1000),
  };
}

/**
 * Procesar evento message.any de WAHA.
 */
export async function processMessageAny(
  organizationId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const msg = normalizeWahaMessage(payload);

  if (!msg.id || !msg.phone) return;

  // Echo: mensaje saliente confirmado
  if (msg.fromMe) {
    // Los echoes de WAHA ya se procesan en el sistema de ingesta existente
    return;
  }

  // Mensaje entrante
  const identity = {
    identity: normalizeMx(msg.phone),
    phone: normalizeMx(msg.phone),
    waUserId: null,
    profileName: msg.pushName ?? null,
    channel: "whatsapp" as Channel,
  };

  const mediaInput = msg.media
    ? {
        kind: (msg.type as "image" | "video" | "audio" | "document" | "sticker") ?? "image",
        waMediaId: null,
        mimeType: null,
        fileName: null,
        caption: msg.text,
        payload: null,
        fetchStatus: "pending" as const,
      }
    : null;

  await ingestInboundMessage({
    organizationId,
    identity,
    waMessageId: msg.id,
    type: msg.type,
    text: msg.text,
    timestamp: String(msg.timestamp),
    media: mediaInput,
  });
}

/**
 * Procesar evento message.ack de WAHA.
 * ACK: 0=error, 1=sent, 2=delivered, 3=read, 4=played
 */
export async function processMessageAck(
  organizationId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const key = payload.key as Record<string, unknown> | undefined;
  const ack = payload.ack as number | undefined;

  const id = payload.id ?? key?.id;
  if (!id || ack === undefined) return;

  const statusMap: Record<number, "sent" | "delivered" | "read" | "failed"> = {
    [-1]: "failed",
    1: "sent",
    2: "delivered",
    3: "read",
    4: "read",
  };

  const status = statusMap[ack];
  if (!status) return;

  await applyStatusUpdate(organizationId, {
    id: id as string,
    status,
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
}

/**
 * Procesar evento session.status de WAHA.
 */
export function processSessionStatus(
  organizationId: string,
  payload: Record<string, unknown>
): void {
  const status = payload.status as string | undefined;
  if (!status) return;
  publish(organizationId, {
    type: "waha.session_status",
    data: { status },
  });
}

/**
 * Handler principal del webhook WAHA.
 * POST /api/webhooks/waha/[token]
 */
export async function handleWahaWebhook(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Buscar credenciales por token (el token es el webhookToken de la URL)
  // En WAHA, el token se configura en la URL del webhook.
  // Aquí simplemente procesamos el body sin verificar el token específicamente,
  // ya que la URL secreta ya protege el endpoint.
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const event = body.event as string | undefined;
  const session = body.session as string | undefined;
  const payload = body.payload as Record<string, unknown> | undefined;

  if (!event || !payload) {
    return NextResponse.json({ ok: true });
  }
  const { getDb, schema } = await import("@/lib/db");
  const matches = await getDb().select().from(schema.wahaCredentials).where(eq(schema.wahaCredentials.sessionName, session ?? ""));
  const authorized = matches.find((cred) => safeEqual(token, wahaWebhookToken(cred.organizationId)));
  if (!authorized) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (await whatsappProvider(authorized.organizationId) !== "waha" && event !== "message.ack") return NextResponse.json({ ok: true });
  try {
    if (event === "message.any" || event === "message") await processMessageAny(authorized.organizationId, payload);
    else if (event === "message.ack") await processMessageAck(authorized.organizationId, payload);
    else if (event === "session.status") processSessionStatus(authorized.organizationId, payload);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
