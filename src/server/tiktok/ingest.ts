import { TT_PREFIX } from "@/server/inbox/identity";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import { applyStatusUpdate } from "@/server/inbox/status";
import {
  getTikTokCredentialsByAccountRef,
} from "@/server/tiktok/credentials";
import {
  zernioSentAtSeconds,
  type ZernioEvent,
} from "@/server/zernio";

/**
 * Adaptador de entrada del canal de TikTok.
 *
 * TikTok DMs solo llegan por Zernio (API unificada). El evento es idéntico
 * al de Instagram/Messenger: `account.platform === "tiktok"`, evento
 * `message.received`, dirección `incoming`.
 *
 * TikTok DMs: solo texto e imágenes (máx 3 MB). Solo se pueden responder
 * a mensajes recibidos (no cold outreach).
 */

const STATUS_MAP: Record<string, string> = {
  "message.sent": "sent",
  "message.delivered": "delivered",
  "message.read": "read",
  "message.failed": "failed",
};

export async function processZernioTikTokEvent(payload: unknown): Promise<void> {
  const evt = payload as ZernioEvent;

  if (evt.account?.platform !== "tiktok") return;

  const accountRef = evt.account?.id;
  if (!accountRef) return;

  const creds = await getTikTokCredentialsByAccountRef(accountRef);
  if (!creds) {
    console.warn(
      `[tiktok] evento para accountId desconocido (${accountRef}): ` +
        "guarda la conexion en Configuracion -> TikTok para recibir mensajes"
    );
    return;
  }
  if (creds.source !== "zernio") {
    console.warn(
      `[tiktok] payload de Zernio en una instancia configurada como '${creds.source}': descartado`
    );
    return;
  }

  const msg = evt.message;
  const platformMessageId = msg?.platformMessageId ?? msg?.id;

  // Acuses de entrega para mensajes salientes (message.sent/delivered/read/failed)
  const status = STATUS_MAP[evt.event ?? ""];
  if (status && msg?.direction === "outgoing" && platformMessageId) {
    await applyStatusUpdate(creds.organizationId, {
      id: platformMessageId,
      status,
      timestamp: String(Math.floor(Date.parse(msg.sentAt ?? "") / 1000) || Math.floor(Date.now() / 1000)),
    });
    return;
  }

  // Solo procesamos mensajes entrantes
  if (evt.event !== "message.received") return;
  if (msg?.direction && msg.direction !== "incoming") return;

  const senderId = msg?.sender?.id;
  if (!senderId) {
    console.warn(`[tiktok] evento ${evt.id ?? "?"} sin sender.id: descartado`);
    return;
  }

  const text = msg?.text ?? null;
  const zernioMessageId = msg?.id;
  if (!zernioMessageId) {
    console.warn(`[tiktok] evento ${evt.id ?? "?"} sin id de mensaje: descartado`);
    return;
  }

  await ingestInboundMessage({
    organizationId: creds.organizationId,
    identity: {
      identity: `${TT_PREFIX}${senderId}`,
      channel: "tiktok",
      phone: null,
      waUserId: null,
      profileName:
        msg?.sender?.name ??
        (msg?.sender?.username
          ? `@${msg.sender.username}`
          : null),
    },
    waMessageId: `tt_${zernioMessageId}`,
    type: "text",
    text,
    timestamp: zernioSentAtSeconds(msg?.sentAt),
    threadRef: msg?.conversationId ?? null,
  });
}
