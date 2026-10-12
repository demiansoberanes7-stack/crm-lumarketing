import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { whatsappProvider } from "@/server/whatsapp/provider";
import { getWhatsappZernio, zernioWhatsappEnabled, type WhatsappZernioCredentials } from "@/server/whatsapp/zernio-credentials";
import { sendWhatsappZernio } from "@/server/whatsapp/zernio-send";
import { getWahaCredentialsFull } from "@/server/waha/credentials";
import { sendText as wahaText, sendFile as wahaFile } from "@/server/waha/client";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { Channel } from "@/lib/channels";
import { graphRequest, MetaApiError, normalizeRecipient } from "@/lib/meta/client";
import { destinatarioMeta, type Destinatario } from "@/lib/meta/destinatario";
import { publish } from "@/server/events/bus";
import { publishWebhook } from "@/server/webhooks/dispatcher";
import { recordDiagnostic } from "@/server/diagnostics/logger";
import {
  getCredentialsByOrg,
  markReconnectRequired,
  type Credentials,
} from "@/server/whatsapp/credentials";
import {
  isHumanAgentWindowOpen,
  isWindowOpenFor,
  WINDOW_MS,
} from "@/server/inbox/window";
import { IG_PREFIX, TT_PREFIX } from "@/server/inbox/identity";
import {
  getInstagramCredentialsByOrg,
  markInstagramReconnectRequired,
  type InstagramCredentials,
} from "@/server/instagram/credentials";
import { sendInstagramText } from "@/server/instagram/send";
import { FB_PREFIX } from "@/server/inbox/identity";
import {
  getMessengerCredentialsByOrg,
  markMessengerReconnectRequired,
  type MessengerCredentials,
} from "@/server/messenger/credentials";
import { sendMessengerMedia as deliverMessengerMedia, sendMessengerText } from "@/server/messenger/send";
import {
  getTikTokCredentialsByOrg,
  markTikTokReconnectRequired,
  type TikTokCredentials,
} from "@/server/tiktok/credentials";
import { sendTikTokText } from "@/server/tiktok/send";
import { zernioFetch } from "@/server/zernio";
import { getGoogleBusinessCredentials } from "@/server/google-business/credentials";
import { exchangeAccessToken, updateReviewReply } from "@/server/google-business/google-api";
import {
  capabilitiesFor,
  textFits,
  windowClosedMessage,
} from "@/server/channels/capabilities";
import { isChannelEnabled } from "@/server/channels/enabled";
import { serializeMessage } from "@/server/inbox/ingest";
import {
  saveMediaFile,
  uploadGraphMedia,
  validateOutgoing,
} from "@/server/whatsapp/media";

/** Error tipado del envío; `code` mapea a HTTP en la capa de API. */
export class SendError extends Error {
  code:
    | "sandbox_violation"
    | "not_connected"
    | "reconnect_required"
    | "window_closed"
    | "meta_error"
    | "meta_unavailable"
    | "upload_failed";
  /** 008: presente cuando el fallo ocurrió TRAS persistir el mensaje (failed). */
  messageId?: string;
  /** Safe provider details retained for diagnostics and the failed-message record. */
  details?: unknown;

  constructor(code: SendError["code"], message: string, details?: unknown) {
    super(message);
    this.name = "SendError";
    this.code = code;
    this.details = details;
  }
}

type SendResult = { messageId: string };

type SendTarget = {
  conversation: typeof schema.conversation.$inferSelect;
  /** null cuando el destino no es WhatsApp (014). */
  credentials: Credentials | null;
  /** El destinatario en la forma que Meta espera: `to` o `recipient`. */
  destinatario: Destinatario;
  /** El identificador a secas, para lo que no arma un payload de Graph. */
  recipient: string;
  /** 014: presente solo en conversaciones de Instagram. */
  instagram?: InstagramCredentials;
  /** 017: presente solo en conversaciones de Messenger. */
  messenger?: MessengerCredentials;
  /** Presente solo en conversaciones de TikTok. */
  tiktok?: TikTokCredentials;
  /** Presente solo en conversaciones de reseñas de Google Business. */
  googleBusiness?: { clientId: string; clientSecret: string; refreshToken: string; reviewName: string };
  /** Presente solo en conversaciones de comentarios de publicaciones. */
  comments?: {
    platform: "instagram" | "messenger" | "tiktok";
    /** Último comentario del autor sobre el post: a ese se responde. */
    replyCommentId: string;
    postExternalId: string;
    token: string;
    accountRef?: string;
  };
  waha?: NonNullable<Awaited<ReturnType<typeof getWahaCredentialsFull>>>;
  zernio?: WhatsappZernioCredentials;
};

/**
 * Pre-flight común de todo envío por la conversación (008): existencia +
 * tenant, sandbox del Laboratorio (ASERCIÓN DURA, FR-031: jamás toca la API
 * real), ventana de 24 h, credenciales y destinatario.
 */
async function prepareSend(
  conversationId: string,
  organizationId: string
): Promise<SendTarget> {
  const db = getDb();
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  let row = rows[0];
  if (!row || row.conversation.organizationId !== organizationId) {
    throw new SendError("meta_error", "Conversación no encontrada");
  }

  if (row.conversation.isTest) {
    throw new SendError(
      "sandbox_violation",
      "Conversación de prueba del Laboratorio: el envío real está prohibido"
    );
  }

  // Recuperación de conversaciones antiguas parcialmente ingeridas: si el
  // marcador quedó vacío pero el mensaje entrante sí existe, reconstruirlo de
  // la fecha original antes de calcular la ventana o enviar una respuesta.
  if (!row.conversation.lastInboundAt) {
    const [latestInbound] = await db
      .select({ waTimestamp: schema.message.waTimestamp, createdAt: schema.message.createdAt })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.organizationId, organizationId),
          eq(schema.message.conversationId, conversationId),
          eq(schema.message.direction, "in")
        )
      )
      .orderBy(desc(sql`coalesce(${schema.message.waTimestamp}, ${schema.message.createdAt})`))
      .limit(1);
    const lastInboundAt = latestInbound?.waTimestamp ?? latestInbound?.createdAt;
    if (lastInboundAt) {
      const [repaired] = await db
        .update(schema.conversation)
        .set({
          lastInboundAt,
          ...(row.conversation.lastMessageAt ? {} : { lastMessageAt: lastInboundAt }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.conversation.id, conversationId),
            isNull(schema.conversation.lastInboundAt)
          )
        )
        .returning({ lastInboundAt: schema.conversation.lastInboundAt });
      const [current] = repaired
        ? []
        : await db
            .select({ lastInboundAt: schema.conversation.lastInboundAt })
            .from(schema.conversation)
            .where(eq(schema.conversation.id, conversationId))
            .limit(1);
      const effectiveLastInboundAt =
        repaired?.lastInboundAt ?? current?.lastInboundAt ?? lastInboundAt;
      row = {
        ...row,
        conversation: {
          ...row.conversation,
          lastInboundAt: effectiveLastInboundAt,
        },
      };
    }
  }

  // 014: Instagram tiene su propio transporte y su propia ventana. Se resuelve
  // antes que las credenciales de WhatsApp para no exigirle a una instancia de
  // solo-Instagram un numero conectado.
  if (row.conversation.channel === "instagram") {
    // Una conversacion de un canal apagado puede existir (se apago despues de
    // recibirla): falla claro en vez de intentar un transporte que no aplica.
    if (!isChannelEnabled("instagram")) {
      throw new SendError(
        "not_connected",
        "El canal de Instagram está desactivado en esta instancia"
      );
    }
    const igCreds = await getInstagramCredentialsByOrg(organizationId);
    if (!igCreds) {
      throw new SendError(
        "not_connected",
        "No hay cuenta de Instagram conectada"
      );
    }
    if (igCreds.status === "reconnect_required") {
      throw new SendError(
        "reconnect_required",
        "El token de Instagram expiró: reconecta la cuenta en Configuración"
      );
    }
    const igRecipient = row.contact.waIdentity.startsWith(IG_PREFIX)
      ? row.contact.waIdentity.slice(IG_PREFIX.length)
      : row.contact.waIdentity;
    return {
      conversation: row.conversation,
      credentials: null,
      // Instagram no pasa por la Graph API de WhatsApp; el campo existe para
      // cumplir el tipo y su camino de envío no lo mira.
      destinatario: { to: igRecipient },
      recipient: igRecipient,
      instagram: igCreds,
    };
  }

  // 017: Messenger, mismo trato que Instagram: transporte propio y ventana
  // propia (con etiqueta fuera de ella).
  if (row.conversation.channel === "messenger") {
    if (!isChannelEnabled("messenger")) {
      throw new SendError(
        "not_connected",
        "El canal de Messenger está desactivado en esta instancia"
      );
    }
    const fbCreds = await getMessengerCredentialsByOrg(organizationId);
    if (!fbCreds) {
      throw new SendError(
        "not_connected",
        "No hay página de Facebook conectada"
      );
    }
    if (fbCreds.status === "reconnect_required") {
      throw new SendError(
        "reconnect_required",
        "El token de la página expiró: reconecta Messenger en Configuración"
      );
    }
    const fbRecipient = row.contact.waIdentity.startsWith(FB_PREFIX)
      ? row.contact.waIdentity.slice(FB_PREFIX.length)
      : row.contact.waIdentity;
    return {
      conversation: row.conversation,
      credentials: null,
      // Messenger tampoco pasa por la Graph API de WhatsApp.
      destinatario: { to: fbRecipient },
      recipient: fbRecipient,
      messenger: fbCreds,
    };
  }

  // TikTok, mismo patrón que Instagram/Messenger: transporte propio vía Zernio.
  if (row.conversation.channel === "tiktok") {
    if (!isChannelEnabled("tiktok")) {
      throw new SendError(
        "not_connected",
        "El canal de TikTok está desactivado en esta instancia"
      );
    }
    const ttCreds = await getTikTokCredentialsByOrg(organizationId);
    if (!ttCreds) {
      throw new SendError(
        "not_connected",
        "No hay cuenta de TikTok conectada"
      );
    }
    if (ttCreds.status === "reconnect_required") {
      throw new SendError(
        "reconnect_required",
        "El token de TikTok expiró: reconecta la cuenta en Configuración"
      );
    }
    const ttRecipient = row.contact.waIdentity.startsWith(TT_PREFIX)
      ? row.contact.waIdentity.slice(TT_PREFIX.length)
      : row.contact.waIdentity;
    return {
      conversation: row.conversation,
      credentials: null,
      destinatario: { to: ttRecipient },
      recipient: ttRecipient,
      tiktok: ttCreds,
    };
  }

  // Reseñas de Google Business: la "respuesta" es un reply público sobre la
  // reseña (resource name en channelThreadRef). Transporte propio, sin
  // ventana de 24 h, sin media, sin recibos.
  if (row.conversation.channel === "google_business") {
    if (!isChannelEnabled("google_business")) {
      throw new SendError(
        "not_connected",
        "El módulo de Google Business está desactivado en esta instancia"
      );
    }
    const gbCreds = await getGoogleBusinessCredentials(organizationId);
    if (!gbCreds) {
      throw new SendError(
        "not_connected",
        "No hay credenciales de Google Business: configúralas en Ajustes → Google Business"
      );
    }
    if (gbCreds.status === "error") {
      throw new SendError(
        "reconnect_required",
        "Google Business rechazó las credenciales: vuelve a pegar el refresh token en Configuración"
      );
    }
    const reviewName = row.conversation.channelThreadRef;
    if (!reviewName) {
      throw new SendError(
        "meta_error",
        "Esta conversación no tiene una reseña asociada para responder"
      );
    }
    return {
      conversation: row.conversation,
      credentials: null,
      destinatario: { to: reviewName },
      recipient: reviewName,
      googleBusiness: { ...gbCreds, reviewName },
    };
  }

  // Comentarios de publicaciones: la "respuesta" es un reply PÚBLICO al
  // comentario (igc/fbc/ttc:post en la identidad). Transporte propio, sin
  // ventana de 24 h, sin media, sin recibos.
  if (row.conversation.channel === "comments") {
    if (!isChannelEnabled("comments")) {
      throw new SendError(
        "not_connected",
        "El canal de Comentarios está desactivado en esta instancia"
      );
    }
    // La identidad del contacto es `{igc|fbc}:{post}:{author}`: de ahí se
    // obtiene el autor y el post para localizar el último comentario a responder.
    const identityParts = row.contact.waIdentity.split(":");
    const prefix = identityParts[0];
    const postExternalId = identityParts[1];
    const authorExternalId = identityParts[2];
    const platform =
      prefix === "igc" ? "instagram" : prefix === "fbc" ? "messenger" : prefix === "ttc" ? "tiktok" : null;
    if (!platform || !postExternalId || !authorExternalId) {
      throw new SendError(
        "meta_error",
        "Esta conversación no tiene un comentario asociado para responder"
      );
    }
    const latestRows = await getDb()
      .select({ externalCommentId: schema.socialComment.externalCommentId })
      .from(schema.socialComment)
      .where(
        and(
          eq(schema.socialComment.organizationId, organizationId),
          eq(schema.socialComment.platform, platform),
          eq(schema.socialComment.postExternalId, postExternalId),
          eq(schema.socialComment.authorExternalId, authorExternalId)
        )
      )
      .orderBy(desc(schema.socialComment.commentTime))
      .limit(1);
    const replyCommentId = latestRows[0]?.externalCommentId;
    if (!replyCommentId) {
      throw new SendError(
        "meta_error",
        "No se encontró el comentario al que responder en esta conversación"
      );
    }
    // El reply público se enruta al transporte de la plataforma del comentario.
    let token: string;
    let accountRef: string | undefined;
    if (platform === "instagram") {
      const igCreds = await getInstagramCredentialsByOrg(organizationId);
      if (!igCreds || igCreds.source !== "meta" || igCreds.status !== "connected") {
        throw new SendError(
          "not_connected",
          "No hay cuenta de Instagram conectada vía Meta para responder comentarios"
        );
      }
      token = igCreds.token;
    } else if (platform === "messenger") {
      const msCreds = await getMessengerCredentialsByOrg(organizationId);
      if (!msCreds || msCreds.source !== "meta" || msCreds.status !== "connected") {
        throw new SendError(
          "not_connected",
          "No hay página de Facebook conectada vía Meta para responder comentarios"
        );
      }
      token = msCreds.token;
    } else {
      const ttCreds = await getTikTokCredentialsByOrg(organizationId);
      if (!ttCreds || ttCreds.status !== "connected" || !ttCreds.accountRef) {
        throw new SendError(
          ttCreds?.status === "reconnect_required" ? "reconnect_required" : "not_connected",
          ttCreds?.status === "reconnect_required"
            ? "La API key de Zernio expiró: reconecta TikTok"
            : "No hay cuenta de TikTok conectada vía Zernio para responder comentarios"
        );
      }
      token = ttCreds.token;
      accountRef = ttCreds.accountRef;
    }
    return {
      conversation: row.conversation,
      credentials: null,
      destinatario: { to: replyCommentId },
      recipient: replyCommentId,
      comments: { platform, replyCommentId, postExternalId, token, accountRef },
    };
  }

  // El nucleo no decide la politica: la consulta. En WhatsApp fuera de ventana
  // no hay salida; Instagram y Messenger etiquetan y siguen; otro canal podria
  // no tener ventana en absoluto.
  const provider = await whatsappProvider(organizationId);
  const caps = capabilitiesFor(row.conversation.channel as Channel);
  if (
    provider !== "waha" && caps.windowMs !== null &&
    caps.outsideWindow === "none" &&
    !isWindowOpenFor(row.conversation.lastInboundAt, caps.windowMs)
  ) {
    throw new SendError(
      "window_closed",
      windowClosedMessage(row.conversation.channel as Channel)
    );
  }

  if (provider === "zernio") {
    const zernio = zernioWhatsappEnabled() ? await getWhatsappZernio(organizationId) : null;
    if (!zernio) throw new SendError("not_connected", "Configura WhatsApp Zernio en Ajustes");
    return { conversation: row.conversation, credentials: null, destinatario: { to: row.contact.waIdentity }, recipient: row.contact.waIdentity, zernio };
  }
  if (provider === "waha") {
    const waha = await getWahaCredentialsFull(organizationId);
    if (!waha) throw new SendError("not_connected", "Configura WAHA en Ajustes");
    if (!row.contact.phone) throw new SendError("meta_error", "WAHA necesita un contacto con teléfono; esta identidad de Meta no es compatible.");
    const recipient = `${row.contact.phone.replace(/\D/g, "")}@c.us`;
    return { conversation: row.conversation, credentials: null, destinatario: { to: recipient }, recipient, waha };
  }
  const credentials = await getCredentialsByOrg(organizationId);
  if (!credentials) {
    throw new SendError("not_connected", "No hay número de WhatsApp conectado");
  }
  if (credentials.status === "reconnect_required") {
    throw new SendError(
      "reconnect_required",
      "El token de WhatsApp expiró: reconecta el número en Configuración"
    );
  }

  /**
   * 003 — El destinatario, en el campo que Meta espera para cada forma.
   *
   * Un teléfono va en `to`; un BSUID va en `recipient` con
   * `recipient_type: "individual"`. Se mandaba el BSUID en `to` y Meta
   * respondía 131026, que en la bandeja se lee como si el número del cliente
   * no existiera.
   */
  const destinatario = destinatarioMeta(
    row.contact.phone ? normalizeRecipient(row.contact.phone) : null,
    row.contact.waUserId
  );
  const recipient = destinatario
    ? "to" in destinatario
      ? destinatario.to
      : destinatario.recipient
    : null;
  if (!destinatario || !recipient) {
    throw new SendError(
      "meta_error",
      "El contacto no tiene teléfono ni identidad de WhatsApp utilizable"
    );
  }

  return { conversation: row.conversation, credentials, destinatario, recipient };
}

async function persistOutbound(input: {
  organizationId: string;
  conversationId: string;
  waMessageId: string | null;
  type: string;
  text: string | null;
  /**
   * 014: 'sent' existe porque no todos los canales confirman por webhook.
   * WhatsApp entra como 'pending' y avanza con los `statuses` de Meta;
   * Instagram no manda ese evento salvo que se suscriba aparte, asi que la
   * aceptacion de la plataforma ES la confirmacion. Sin esto el mensaje se
   * queda con el reloj puesto para siempre aunque ya se haya entregado.
   */
  status: "pending" | "sent" | "failed";
  error?: string | null;
  aiGenerated?: boolean;
  origin: "ai" | "operator";
  mediaAssetId?: string | null;
  media?: typeof schema.mediaAsset.$inferSelect | null;
  /** Pre-generated ID for idempotent sends (Instagram/Zernio). */
  preGeneratedId?: string;
}): Promise<string> {
  const db = getDb();
  const msgId = input.preGeneratedId ?? newId("message");
  await db
    .insert(schema.message)
    .values({
      id: msgId,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId: input.waMessageId,
      direction: "out",
      type: input.type,
      text: input.text,
      status: input.status,
      error: input.error ?? null,
      aiGenerated: input.aiGenerated ?? false,
      origin: input.origin,
      mediaAssetId: input.mediaAssetId ?? null,
    });
  const [message] = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.id, msgId))
    .limit(1);
  if (!message) throw new Error("No se encontró el mensaje persistido");

  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, input.conversationId));

  publish(input.organizationId, {
    type: "message.new",
    data: {
      conversationId: input.conversationId,
      message: serializeMessage(message, input.media ?? null),
    },
  });

  publishWebhook(input.organizationId, "message.outbound", {
    conversationId: input.conversationId,
    messageId: message.id,
  });

  return message.id;
}

/** Envía un mensaje de texto libre por WhatsApp. */
export async function sendText(input: {
  conversationId: string;
  organizationId: string;
  text: string;
  aiGenerated?: boolean;
}): Promise<SendResult> {
  const target = await prepareSend(input.conversationId, input.organizationId);
  const { credentials } = target;

  // Pre-generate message ID for Zernio idempotent sends (Instagram, TikTok).
  const preGenId =
    target.instagram ||
    target.tiktok ||
    target.zernio ||
    target.comments?.platform === "tiktok"
      ? newId("message")
      : undefined;

  const waMessageId = target.googleBusiness
    ? await callGoogleBusinessReply(target, input.text)
    : target.comments
     ? await callCommentsReply(target, input.text, preGenId)
    : target.zernio
    ? await callWhatsappZernio(target, { message: input.text }, preGenId!)
    : target.waha
    ? (await wahaText(target.waha.baseUrl, target.waha.apiKey, target.waha.sessionName, target.recipient, input.text)).key.id
    : target.instagram
    ? await callInstagramSend(target, input.text, preGenId)
    : target.tiktok
      ? await callTikTokSend(target, input.text, preGenId)
      : target.messenger
        ? await callMessengerSend(target, input.text)
        : await callGraphSend(credentials!, {
            messaging_product: "whatsapp",
            ...target.destinatario,
            type: "text",
            text: { body: input.text },
          });

  const messageId = await persistOutbound({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    waMessageId,
    type: "text",
    text: input.text,
    // Un canal sin acuses de entrega confirma al aceptar; uno con acuses
    // avanza despues por webhook. Sin esta distincion el mensaje se queda
    // con el reloj puesto para siempre.
    status: capabilitiesFor(target.conversation.channel as Channel).deliveryReceipts
      ? "pending"
      : "sent",
    aiGenerated: input.aiGenerated,
    origin: input.aiGenerated ? "ai" : "operator",
    preGeneratedId: preGenId,
  });

  return { messageId };
}

/**
 * 008 — Envía un adjunto de archivo (imagen/video/audio/documento).
 * El archivo queda ANTES en el volumen local (fuente durable de la preview);
 * si Graph falla tras eso, el mensaje se persiste `failed` (visible en el
 * hilo, nunca se pierde en silencio) y el SendError lleva `messageId`.
 */
export async function sendMediaMessage(input: {
  conversationId: string;
  organizationId: string;
  file: { data: Buffer; mimeType: string; fileName?: string };
  caption?: string;
}): Promise<SendResult> {
  // Validación previa (FR-007): tipo y tamaño antes de tocar disco o red.
  const kind = validateOutgoing(input.file.mimeType, input.file.data.byteLength);

  const target = await prepareSend(input.conversationId, input.organizationId);
  const { credentials } = target;
  const sendCaps = capabilitiesFor(target.conversation.channel as Channel);
  if (!sendCaps.outboundMedia) {
    throw new SendError(
      "meta_error",
      `Todavía no se pueden enviar adjuntos por ${sendCaps.label}; manda el texto`
    );
  }

  const db = getDb();
  const assetId = newId("mediaAsset");
  const storagePath = await saveMediaFile(
    input.organizationId,
    assetId,
    input.file.data
  );
  await db
    .insert(schema.mediaAsset)
    .values({
      id: assetId,
      organizationId: input.organizationId,
      kind,
      mimeType: input.file.mimeType,
      fileName: input.file.fileName ?? null,
      fileSize: input.file.data.byteLength,
      caption: input.caption ?? null,
      storagePath,
      fetchStatus: "available",
    });
  const [asset] = await db
    .select()
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.id, assetId))
    .limit(1);

  if (target.messenger) {
    let mediaPlatformId: string;
    try {
      mediaPlatformId = await callMessengerMedia(target, {
        data: input.file.data,
        mimeType: input.file.mimeType,
        fileName: input.file.fileName,
        kind,
      });
    } catch (err) {
      const sendErr = err instanceof SendError
        ? err
        : new SendError("meta_unavailable", "No se pudo enviar el adjunto por Messenger");
      sendErr.messageId = await persistOutbound({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        waMessageId: null,
        type: kind,
        text: null,
        status: "failed",
        error: sendErr.message,
        origin: "operator",
        mediaAssetId: assetId,
        media: asset!,
      });
      throw sendErr;
    }

    const messageId = await persistOutbound({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId: mediaPlatformId,
      type: kind,
      text: null,
      status: "sent",
      origin: "operator",
      mediaAssetId: assetId,
      media: asset!,
    });

    if (input.caption?.trim()) {
      try {
        const captionPlatformId = await callMessengerSend(target, input.caption.trim());
        await persistOutbound({
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          waMessageId: captionPlatformId,
          type: "text",
          text: input.caption.trim(),
          status: "sent",
          origin: "operator",
        });
      } catch (err) {
        await persistOutbound({
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          waMessageId: null,
          type: "text",
          text: input.caption.trim(),
          status: "failed",
          error: err instanceof Error ? err.message : "No se pudo enviar el pie del adjunto",
          origin: "operator",
        });
      }
    }
    return { messageId };
  }

  try {
    if (target.zernio) {
      const preGenId = newId("message");
      const id = await callWhatsappZernio(target, { message: input.caption ?? "", attachmentType: kind === "document" ? "file" : kind }, preGenId, input.file);
      return { messageId: await persistOutbound({ organizationId: input.organizationId, conversationId: input.conversationId, waMessageId: id, type: kind, text: null, status: "pending", origin: "operator", mediaAssetId: assetId, media: asset!, preGeneratedId: preGenId }) };
    }
    if (target.waha) {
      const sent = await wahaFile(target.waha.baseUrl, target.waha.apiKey, target.waha.sessionName, target.recipient, { mimetype: input.file.mimeType, data: input.file.data.toString("base64"), filename: input.file.fileName, caption: input.caption });
      return { messageId: await persistOutbound({ organizationId: input.organizationId, conversationId: input.conversationId, waMessageId: sent.key.id, type: kind, text: null, status: "sent", origin: "operator", mediaAssetId: assetId, media: asset! }) };
    }
    const waMediaId = await uploadGraphMedia(credentials!, input.file);
    await db
      .update(schema.mediaAsset)
      .set({ waMediaId, updatedAt: new Date() })
      .where(eq(schema.mediaAsset.id, assetId));

    const mediaPayload: Record<string, unknown> = { id: waMediaId };
    if (input.caption && kind !== "audio") mediaPayload.caption = input.caption;
    if (kind === "document" && input.file.fileName) {
      mediaPayload.filename = input.file.fileName;
    }
    const waMessageId = await callGraphSend(credentials!, {
      messaging_product: "whatsapp",
      ...target.destinatario,
      type: kind,
      [kind]: mediaPayload,
    });

    const messageId = await persistOutbound({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId,
      type: kind,
      text: null,
      status: "pending",
      origin: "operator",
      mediaAssetId: assetId,
      media: asset!,
    });
    return { messageId };
  } catch (err) {
    let sendErr: SendError;
    if (err instanceof SendError) {
      sendErr = err;
    } else if (err instanceof MetaApiError && err.isAuthError) {
      // Mismo criterio que el texto: SOLO 401/código 190 (fix 2026-08-04).
      await markReconnectRequired(input.organizationId);
      sendErr = new SendError(
        "reconnect_required",
        "El token de WhatsApp expiró: reconecta el número en Configuración"
      );
    } else {
      sendErr = new SendError(
        "upload_failed",
        "No se pudo subir el adjunto a WhatsApp"
      );
    }
    if (target.zernio) {
      await recordDiagnostic({
        organizationId: input.organizationId,
        source: "whatsapp",
        code: "send_failed",
        error: sendErr,
        metadata: { operation: "send-media", provider: "zernio", conversationId: input.conversationId },
      });
    }
    // El contenido NO se pierde: mensaje failed con el asset ya en disco.
    sendErr.messageId = await persistOutbound({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      waMessageId: null,
      type: kind,
      text: null,
      status: "failed",
      error: sendErr.message,
      origin: "operator",
      mediaAssetId: assetId,
      media: asset!,
    });
    throw sendErr;
  }
}

export type LocationInput = {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
};

export type ContactInput = { name: string; phone: string };

/** 008 — Envía una ubicación o contactos (payload estructurado, sin archivo). */
export async function sendStructured(
  input: {
    conversationId: string;
    organizationId: string;
  } & (
    | { kind: "location"; location: LocationInput }
    | { kind: "contacts"; contacts: ContactInput[] }
  )
): Promise<SendResult> {
  const target = await prepareSend(
    input.conversationId,
    input.organizationId
  );
  // Ubicaciones y contactos son mensajes de WhatsApp: en los demás canales no
  // hay credenciales de WhatsApp que usar y Graph los rechazaría.
  if (!target.credentials && !target.zernio) {
    throw new SendError(
      "meta_error",
      "Este canal no admite ubicaciones ni contactos; manda el texto"
    );
  }

  const payload =
    input.kind === "location"
      ? { type: "location", location: input.location }
      : {
          type: "contacts",
          contacts: input.contacts.map((c) => ({
            name: { formatted_name: c.name, first_name: c.name },
            phones: [{ phone: c.phone, type: "CELL" }],
          })),
        };

  const waMessageId = target.zernio ? await callWhatsappZernio(target, input.kind === "location" ? { location: input.location } : { contacts: input.contacts.map((c) => ({ name: { formatted_name: c.name, first_name: c.name }, phones: [{ phone: c.phone, type: "CELL" }] })) }, newId("message")) : await callGraphSend(target.credentials!, {
    messaging_product: "whatsapp",
    ...target.destinatario,
    ...payload,
  });

  const db = getDb();
  const assetId = newId("mediaAsset");
  await db
    .insert(schema.mediaAsset)
    .values({
      id: assetId,
      organizationId: input.organizationId,
      kind: input.kind,
      payload: input.kind === "location" ? input.location : input.contacts,
      fetchStatus: "available",
    });
  const [asset] = await db
    .select()
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.id, assetId))
    .limit(1);

  const messageId = await persistOutbound({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    waMessageId,
    type: input.kind,
    text: null,
    status: "pending",
    origin: "operator",
    mediaAssetId: asset!.id,
    media: asset!,
  });
  return { messageId };
}

async function callWhatsappZernio(target: SendTarget, body: Record<string, unknown>, key: string, file?: { data: Buffer; mimeType: string; fileName?: string }) {
  try { return await sendWhatsappZernio(target.zernio!, target.conversation.channelThreadRef, body, key, file); }
  catch (err) {
    if (err instanceof MetaApiError) {
      const details = err.details && typeof err.details === "object" ? err.details as Record<string, unknown> : null;
      const code = typeof details?.code === "string" ? ` · ${details.code}` : "";
      const requestId = typeof details?.requestId === "string" ? ` · referencia ${details.requestId}` : "";
      const message = err.isAuthError
        ? "Reconecta la API key de Zernio en Ajustes"
        : `${err.message}${code}${requestId}`;
      throw new SendError(
        err.isAuthError ? "reconnect_required" : err.status === 0 || err.status >= 500 ? "meta_unavailable" : "meta_error",
        message,
        err.details
      );
    }
    throw err;
  }
}

/** Llama a Graph /messages y traduce errores de Meta a SendError. */
export async function callGraphSend(
  credentials: Credentials,
  payload: unknown
): Promise<string> {
  try {
    const res = await graphRequest<{ messages?: { id: string }[] }>(
      `${credentials.phoneNumberId}/messages`,
      { method: "POST", token: credentials.token, body: payload }
    );
    const id = res.messages?.[0]?.id;
    if (!id) throw new SendError("meta_error", "Meta no devolvió ID de mensaje");
    return id;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markReconnectRequired(credentials.organizationId);
        throw new SendError(
          "reconnect_required",
          "El token de WhatsApp expiró: reconecta el número en Configuración"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError("meta_unavailable", "Meta no está disponible ahora");
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}


/**
 * 014 — Envío por el canal de Instagram. Traduce los fallos al mismo
 * vocabulario de SendError que ya usa WhatsApp, para que la bandeja no tenga
 * que aprender un idioma por plataforma.
 */
async function callInstagramSend(
  target: SendTarget,
  text: string,
  idempotencyKey?: string
): Promise<string> {
  const creds = target.instagram!;

  const caps = capabilitiesFor("instagram");
  if (!textFits("instagram", text)) {
    throw new SendError(
      "meta_error",
      `${caps.label} no acepta mensajes de más de ${caps.maxTextBytes} bytes: acorta el texto`
    );
  }

  // Instagram: fuera de la ventana de 24 h la única vía es la etiqueta de
  // agente humano (hasta 7 días).
  const humanAgentTag = requireReplyWindow("instagram", target.conversation.lastInboundAt);

  try {
    const res = await sendInstagramText({
      credentials: creds,
      recipient: target.recipient,
      threadRef: target.conversation.channelThreadRef,
      text,
      humanAgentTag,
      idempotencyKey,
    });
    return res.platformMessageId;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markInstagramReconnectRequired(creds.organizationId);
        throw new SendError(
          "reconnect_required",
          "El token de Instagram expiró o fue revocado: reconecta la cuenta"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError(
          "meta_unavailable",
          "Instagram no está disponible en este momento; intenta de nuevo"
        );
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}

/**
 * 017 — Envío por el canal de Messenger. Mismo vocabulario de SendError que
 * WhatsApp e Instagram: la bandeja no aprende un idioma por plataforma.
 */
async function callMessengerSend(
  target: SendTarget,
  text: string
): Promise<string> {
  const creds = target.messenger!;

  const caps = capabilitiesFor("messenger");
  if (!textFits("messenger", text)) {
    throw new SendError(
      "meta_error",
      `${caps.label} no acepta mensajes de más de ${caps.maxTextBytes} bytes: acorta el texto`
    );
  }

  // Messenger: fuera de la ventana de 24 h la única vía es la etiqueta de
  // agente humano (hasta 7 días).
  const humanAgentTag = requireReplyWindow("messenger", target.conversation.lastInboundAt);

  try {
    const res = await sendMessengerText({
      credentials: creds,
      recipient: target.recipient,
      // Zernio responde dentro de SU conversación, no al PSID: sin esta
      // referencia el envío no tiene a dónde ir.
      threadRef: target.conversation.channelThreadRef,
      text,
      humanAgentTag,
    });
    return res.platformMessageId;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markMessengerReconnectRequired(creds.organizationId);
        throw new SendError(
          "reconnect_required",
          "El token de la página expiró o fue revocado: reconecta Messenger"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError(
          "meta_unavailable",
          "Messenger no está disponible en este momento; intenta de nuevo"
        );
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}

async function callMessengerMedia(
  target: SendTarget,
  input: {
    data: Buffer;
    mimeType: string;
    fileName?: string;
    kind: "image" | "video" | "audio" | "document";
  }
): Promise<string> {
  const creds = target.messenger!;
  const attachmentType = input.kind === "document" ? "file" : input.kind;
  try {
    const result = await deliverMessengerMedia({
      credentials: creds,
      recipient: target.recipient,
      threadRef: target.conversation.channelThreadRef,
      data: input.data,
      mimeType: input.mimeType,
      fileName: input.fileName,
      attachmentType,
      humanAgentTag: requireReplyWindow("messenger", target.conversation.lastInboundAt),
    });
    return result.platformMessageId;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markMessengerReconnectRequired(creds.organizationId);
        throw new SendError("reconnect_required", "El token de Messenger expiró: reconecta la página");
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError("meta_unavailable", "Messenger no pudo aceptar el adjunto; intenta de nuevo");
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}

/**
 * Envío por el canal de TikTok. Traduce los fallos al mismo vocabulario
 * de SendError que los demás canales.
 */
async function callTikTokSend(
  target: SendTarget,
  text: string,
  idempotencyKey?: string
): Promise<string> {
  const creds = target.tiktok!;

  const caps = capabilitiesFor("tiktok");
  if (!textFits("tiktok", text)) {
    throw new SendError(
      "meta_error",
      `${caps.label} no acepta mensajes de más de ${caps.maxTextBytes} bytes: acorta el texto`
    );
  }

  const humanAgentTag = requireReplyWindow("tiktok", target.conversation.lastInboundAt);
  await enforceTikTokReplyLimit(target.conversation.id, target.conversation.lastInboundAt);

  try {
    const res = await sendTikTokText({
      credentials: creds,
      recipient: target.recipient,
      threadRef: target.conversation.channelThreadRef,
      text,
      humanAgentTag,
      idempotencyKey,
    });
    return res.platformMessageId;
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        await markTikTokReconnectRequired(creds.organizationId);
        throw new SendError(
          "reconnect_required",
          "El token de TikTok expiró o fue revocado: reconecta la cuenta"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError(
          "meta_unavailable",
          "TikTok no está disponible en este momento; intenta de nuevo"
        );
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}

/** TikTok allows at most 10 outgoing replies after each customer message. */
async function enforceTikTokReplyLimit(
  conversationId: string,
  lastInboundAt: Date | null
): Promise<void> {
  if (!lastInboundAt) return;
  const replies = await getDb()
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "out"),
        gte(schema.message.createdAt, lastInboundAt)
      )
    )
    .limit(10);
  if (replies.length >= 10) {
    throw new SendError(
      "window_closed",
      "TikTok permite hasta 10 respuestas por cada mensaje del cliente; espera a que vuelva a escribir"
    );
  }
}

/** Enforce the platform's real reply window; HUMAN_AGENT extends IG/Messenger only. */
function requireReplyWindow(
  channel: "instagram" | "messenger" | "tiktok",
  lastInboundAt: Date | null
): boolean {
  const caps = capabilitiesFor(channel);
  const windowMs = caps.windowMs ?? WINDOW_MS;
  if (isWindowOpenFor(lastInboundAt, windowMs)) return false;

  if (
    caps.outsideWindow === "human_agent_tag" &&
    isHumanAgentWindowOpen(lastInboundAt)
  ) {
    return true;
  }

  const message =
    channel === "tiktok"
      ? "La ventana de respuesta de TikTok dura 48 horas; espera a que el cliente vuelva a escribir"
      : `Pasaron 7 días desde el último mensaje: ${caps.label} ya no permite responder con la etiqueta de agente humano`;
  throw new SendError("window_closed", message);
}

/**
 * Reply de una reseña de Google Business: el texto del operador se publica
 * como respuesta PÚBLICA del negocio sobre la reseña (hasta 4096 chars, sin
 * ventana de 24 h). El "id de mensaje" devuelto es el resource name de la
 * reseña: la respuesta no genera un mensaje nuevo en Google.
 */
async function callGoogleBusinessReply(target: SendTarget, text: string): Promise<string> {
  const creds = target.googleBusiness!;

  const caps = capabilitiesFor("google_business");
  if (!textFits("google_business", text)) {
    throw new SendError(
      "meta_error",
      `${caps.label} no acepta replies de más de ${caps.maxTextBytes} bytes: acorta el texto`
    );
  }

  const token = await exchangeAccessToken(creds);
  if ("error" in token) {
    throw new SendError(
      "reconnect_required",
      `Google rechazó el refresh token (${token.error}): vuelve a conectar Google Business en Configuración`
    );
  }

  const result = await updateReviewReply(token, creds.reviewName, text);
  if ("error" in result) {
    throw new SendError("meta_error", `Google Business rechazó el reply: ${result.error}`);
  }

  // Refleja el reply en la tabla local (la UI lo muestra y el poller no lo pisa:
  // el próximo sync leerá el mismo reply de la API).
  await getDb()
    .update(schema.googleBusinessReview)
    .set({
      replyComment: text,
      repliedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.googleBusinessReview.organizationId, target.conversation.organizationId),
        eq(schema.googleBusinessReview.reviewName, creds.reviewName)
      )
    );

  // Cada reply es un mensaje saliente NUEVO: Google acepta editar el reply de
  // una reseña, así que el reviewName se repetiría y el UNIQUE de
  // wa_message_id reventaría DESPUÉS de publicar. Un id único por envío.
  return newId("message");
}

/**
 * Reply a un comentario de publicación (Instagram / Facebook / TikTok): el
 * texto del operador se publica como respuesta PÚBLICA del negocio sobre el
 * comentario (igc/fbc). Sin ventana de 24 h, sin media, sin recibos. El "id
 * de mensaje" devuelto es el id del reply en la plataforma.
 */
async function callCommentsReply(
  target: SendTarget,
  text: string,
  idempotencyKey?: string
): Promise<string> {
  const { platform, replyCommentId, postExternalId, token, accountRef } = target.comments!;

  const caps = capabilitiesFor("comments");
  if (!textFits("comments", text)) {
    throw new SendError(
      "meta_error",
      `${caps.label} no acepta replies de más de ${caps.maxTextBytes} bytes: acorta el texto`
    );
  }

  try {
    let replyId: string | undefined;
    if (platform === "tiktok") {
      // Zernio publica la respuesta pública del negocio. La llave local de
      // mensaje sirve como Idempotency-Key si la plataforma acepta el reply
      // pero la respuesta HTTP se pierde.
      const result = (await zernioFetch(
        `/inbox/comments/${encodeURIComponent(postExternalId)}`,
        {
          method: "POST",
          token,
          body: { accountId: accountRef, message: text, commentId: replyCommentId },
          headers: { "Idempotency-Key": idempotencyKey ?? newId("message") },
        }
      )) as { data?: { commentId?: string } };
      replyId = result.data?.commentId;
    } else {
      // Instagram y Facebook publican replies vía Graph API, POST al
      // comentario con { message }. El token va en el header Authorization.
      const res = await graphRequest<{ id?: string }>(`${replyCommentId}/replies`, {
        method: "POST",
        token,
        body: { message: text },
      });
      replyId = res.id;
    }

    // Refleja el reply en la tabla local (el poller no lo pisa: el próximo sync
    // no reingerirá el comentario original porque externalCommentId ya existe).
    await getDb()
      .update(schema.socialComment)
      .set({ replyText: text, repliedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.socialComment.organizationId, target.conversation.organizationId),
          eq(schema.socialComment.externalCommentId, replyCommentId)
        )
      );

    return replyId ?? newId("message");
  } catch (err) {
    if (err instanceof MetaApiError) {
      if (err.isAuthError) {
        if (platform === "instagram") {
          await markInstagramReconnectRequired(target.conversation.organizationId);
        } else if (platform === "messenger") {
          await markMessengerReconnectRequired(target.conversation.organizationId);
        } else {
          await markTikTokReconnectRequired(target.conversation.organizationId);
        }
        throw new SendError(
          "reconnect_required",
          platform === "instagram"
            ? "El token de Instagram expiró: reconecta la cuenta"
            : platform === "messenger"
              ? "El token de la página expiró: reconecta Messenger"
              : "La API key de Zernio expiró: reconecta TikTok"
        );
      }
      if (err.status === 0 || err.status >= 500) {
        throw new SendError(
          "meta_unavailable",
          "La plataforma no está disponible en este momento; intenta de nuevo"
        );
      }
      throw new SendError("meta_error", err.message);
    }
    throw err;
  }
}
