import { TT_PREFIX } from "@/server/inbox/identity";
import { ingestInboundMessage } from "@/server/inbox/ingest";
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

export async function processZernioTikTokEvent(payload: unknown): Promise<void> {
  const evt = payload as ZernioEvent;

  if (evt.account?.platform !== "tiktok") return;
  if (evt.event !== "message.received") return;
  if (evt.message?.direction && evt.message.direction !== "incoming") return;

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

  const senderId = evt.message?.sender?.id;
  if (!senderId) {
    console.warn(`[tiktok] evento ${evt.id ?? "?"} sin sender.id: descartado`);
    return;
  }

  const text = evt.message?.text ?? null;
  const zernioMessageId = evt.message?.id;
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
        evt.message?.sender?.name ??
        (evt.message?.sender?.username
          ? `@${evt.message.sender.username}`
          : null),
    },
    waMessageId: `tt_${zernioMessageId}`,
    type: "text",
    text,
    timestamp: zernioSentAtSeconds(evt.message?.sentAt),
    threadRef: evt.message?.conversationId ?? null,
  });
}
