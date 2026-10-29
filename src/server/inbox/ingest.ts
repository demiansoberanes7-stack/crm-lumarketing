import { and, eq, gte, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizeMx } from "@/lib/meta/client";
import { publish } from "@/server/events/bus";
import { publishWebhook } from "@/server/webhooks/dispatcher";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import { ensureAssetAvailable } from "@/server/whatsapp/media";
import type { Channel } from "@/lib/channels";
import type {
  WebhookMediaPayload,
  WebhookMessage,
  WebhookReferral,
  WebhookValue,
} from "@/server/inbox/webhook";
import {
  getOrCreateContactByIdentity,
  resolveIdentity,
  type ResolvedIdentity,
} from "@/server/inbox/identity";
import { applyStatusUpdate } from "@/server/inbox/status";
import { atribucionEnabled } from "@/server/attribution/flag";
import { recordAttribution } from "@/server/attribution/store";
import { recordReferralTouch } from "@/server/attribution/touch";
import { onLeadActivity } from "@/server/inbox/lead-activity";
import { captureContactPhoneFromText } from "@/server/inbox/phone-capture";
import { requeueWaitingBroadcasts } from "@/server/broadcasts/requeue";
import { maybeRunAgentTurn } from "@/server/ai/trigger";
import type { MessageCommentDto, MessageDto, MessageMediaDto } from "@/lib/types";

/** Tipos de contenido soportados; el resto se ignora sin error. */
const SUPPORTED_TYPES = new Set([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
]);

/** Tipos con archivo binario en Graph (008). */
const BINARY_MEDIA_TYPES = new Set([
  "image",
  "video",
  "audio",
  "document",
  "sticker",
] as const);

type MediaInput = {
  kind: (typeof schema.mediaAsset.$inferSelect)["kind"];
  waMediaId: string | null;
  mimeType: string | null;
  fileName: string | null;
  caption: string | null;
  payload: unknown;
  fetchStatus: "available" | "pending";
};

/**
 * 008 — Extrae el adjunto de un mensaje del webhook (entrante o echo).
 * Tolerante: payload incompleto → null (el mensaje se conserva sin adjunto).
 */
export function mediaInputFrom(msg: WebhookMessage): MediaInput | null {
  if (msg.type === "location" && msg.location) {
    const { latitude, longitude } = msg.location;
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return null;
    }
    return {
      kind: "location",
      waMediaId: null,
      mimeType: null,
      fileName: null,
      caption: null,
      payload: msg.location,
      fetchStatus: "available",
    };
  }
  if (msg.type === "contacts" && Array.isArray(msg.contacts) && msg.contacts.length) {
    return {
      kind: "contacts",
      waMediaId: null,
      mimeType: null,
      fileName: null,
      caption: null,
      payload: msg.contacts,
      fetchStatus: "available",
    };
  }
  if ((BINARY_MEDIA_TYPES as Set<string>).has(msg.type)) {
    const media = msg[msg.type as "image" | "video" | "audio" | "document" | "sticker"] as
      | WebhookMediaPayload
      | undefined;
    if (!media?.id) return null;
    return {
      kind: msg.type as MediaInput["kind"],
      waMediaId: media.id,
      mimeType: media.mime_type ?? null,
      fileName: media.filename ?? null,
      caption: media.caption ?? null,
      payload: null,
      fetchStatus: "pending",
    };
  }
  return null;
}

/**
 * Crea el media_asset de un mensaje recién insertado y dispara la descarga en
 * segundo plano si hay binario. Jamás lanza hacia el webhook (FR-013).
 */
async function attachMediaAsset(
  organizationId: string,
  messageId: string,
  media: MediaInput
): Promise<typeof schema.mediaAsset.$inferSelect | null> {
  try {
    const db = getDb();
    const assetId = newId("mediaAsset");
    await db
      .insert(schema.mediaAsset)
      .values({
        id: assetId,
        organizationId,
        kind: media.kind,
        waMediaId: media.waMediaId,
        mimeType: media.mimeType,
        fileName: media.fileName,
        caption: media.caption,
        payload: media.payload ?? null,
        fetchStatus: media.fetchStatus,
      });
    await db
      .update(schema.message)
      .set({ mediaAssetId: assetId })
      .where(eq(schema.message.id, messageId));
    if (media.fetchStatus === "pending") {
      // Descarga in-process, sin bloquear la ingesta; on-demand reintenta.
      void ensureAssetAvailable(organizationId, assetId).catch(() => {});
    }
    const [asset] = await db
      .select()
      .from(schema.mediaAsset)
      .where(eq(schema.mediaAsset.id, assetId))
      .limit(1);
    return asset ?? null;
  } catch (err) {
    console.warn(`[media] no se pudo registrar el adjunto de ${messageId}:`, err);
    return null;
  }
}

/**
 * Alta/resolución de contacto por teléfono (alta manual / seeds). La ingesta
 * del webhook usa `getOrCreateContactByIdentity` (003) — este helper deriva la
 * identidad del teléfono normalizado y delega ahí.
 */
export async function getOrCreateContact(
  organizationId: string,
  phone: string,
  name?: string | null
) {
  const normalized = normalizeMx(phone);
  return getOrCreateContactByIdentity(organizationId, {
    identity: normalized,
    phone: normalized,
    waUserId: null,
    profileName: name ?? null,
  });
}

export async function getOrCreateConversation(
  organizationId: string,
  contactId: string,
  opts?: { channel?: Channel; threadRef?: string | null }
) {
  const db = getDb();
  const convId = newId("conversation");
  await db
    .insert(schema.conversation)
    .values({
      id: convId,
      organizationId,
      contactId,
      channel: opts?.channel ?? "whatsapp",
      channelThreadRef: opts?.threadRef ?? null,
    })
    .onConflictDoNothing();
  const [inserted] = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, convId))
    .limit(1);
  if (inserted) {
    // Webhooks de salida, solo cuando la fila es NUEVA. El Laboratorio inserta
    // sus conversaciones de prueba a mano con `isTest: true` y nunca pasa por
    // aquí, así que un simulacro jamás sale notificado al exterior.
    publishWebhook(organizationId, "conversation.created", {
      conversationId: inserted.id,
      contactId: inserted.contactId,
      channel: inserted.channel,
      isTest: inserted.isTest,
    });
    return inserted;
  }

  const rows = await db
    .select()
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new Error("conversación no encontrada tras upsert");
  // 014: el hilo de la plataforma puede aparecer despues (o cambiar); se
  // guarda en cuanto se conoce para poder responder.
  if (opts?.threadRef && existing.channelThreadRef !== opts.threadRef) {
    await db
      .update(schema.conversation)
      .set({ channelThreadRef: opts.threadRef, updatedAt: new Date() })
      .where(eq(schema.conversation.id, existing.id));
    existing.channelThreadRef = opts.threadRef;
  }
  return existing;
}

/**
 * Procesa el `value` de un cambio `messages` del webhook: mensajes entrantes
 * (idempotentes por wa_message_id) y actualizaciones de estado.
 */
export async function processMessagesValue(value: WebhookValue): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) {
    // Caso típico: webhook/override configurado ANTES de guardar la conexión
    // en el wizard — el evento llega pero no hay a qué organización enrutarlo.
    console.warn(
      `[webhook] evento para phone_number_id desconocido (${phoneNumberId}): ` +
        "guarda la conexión en Configuración → WhatsApp para recibir mensajes"
    );
    return;
  }

  const organizationId = credentials.organizationId;

  for (const status of value.statuses ?? []) {
    try {
      await applyStatusUpdate(organizationId, status);
    } catch (err) {
      // Un estado malformado no descarta los demás ni los mensajes del batch
      // (Meta ya recibió el 200: no reintenta).
      console.error(`[webhook] error procesando estado ${status.id ?? "?"}:`, err);
    }
  }
  const { whatsappProvider } = await import("@/server/whatsapp/provider");
  if (await whatsappProvider(organizationId) !== "meta") return;

  for (const msg of value.messages ?? []) {
    if (!SUPPORTED_TYPES.has(msg.type)) continue; // reacciones, etc.: ignorar
    // Un error por mensaje (carrera de upsert, fallo de BD, media roto) no
    // debe abortar el RESTO del batch: la ruta ya respondió 200 y Meta no
    // reintenta, así que el descarte sería permanente.
    try {
      const resolved = resolveIdentity(msg, value.contacts);
      if (!resolved) {
        // Mensaje sin NINGUNA identidad utilizable (ni teléfono ni BSUID):
        // registrar y descartar — jamás reventar el webhook (003).
        console.warn(
          `[webhook] mensaje ${msg.id} sin identidad utilizable (sin from ni from_user_id): descartado`
        );
        continue;
      }
      await ingestInboundMessage({
        organizationId,
        identity: resolved,
        waMessageId: msg.id,
        type: msg.type,
        text: msg.text?.body ?? null,
        timestamp: msg.timestamp,
        media: mediaInputFrom(msg),
        referral: msg.referral ?? null,
      });
    } catch (err) {
      console.error(`[webhook] error procesando mensaje ${msg.id}:`, err);
    }
  }
}

/**
 * 008 — Echoes de coexistence (`smb_message_echoes`): mensajes que el dueño
 * envió A MANO desde la app de WhatsApp Business del teléfono. Se registran
 * como salientes `origin='manual'` y pausan la IA (decisión del dueño
 * 2026-08-04). JAMÁS tocan la ventana de 24 h ni disparan al agente.
 */
export async function processEchoesValue(value: WebhookValue): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) {
    console.warn(
      `[webhook] echo para phone_number_id desconocido (${phoneNumberId}): descartado`
    );
    return;
  }

  // Meta documenta `message_echoes`; parser tolerante a `messages` (R1).
  const echoes = value.message_echoes ?? value.messages ?? [];
  for (const echo of echoes) {
    if (!SUPPORTED_TYPES.has(echo.type)) continue;
    if (!echo.to) {
      console.warn(`[webhook] echo ${echo.id} sin destinatario: descartado`);
      continue;
    }
    try {
      await ingestManualEcho(credentials.organizationId, echo);
    } catch (err) {
      // Un echo malformado jamás tumba el webhook (edge case del spec).
      console.error(`[webhook] error procesando echo ${echo.id}:`, err);
    }
  }
}

async function ingestManualEcho(
  organizationId: string,
  echo: WebhookMessage
): Promise<void> {
  const db = getDb();
  const identity = normalizeMx(echo.to!);

  const { contact } = await getOrCreateContactByIdentity(organizationId, {
    identity,
    phone: identity,
    waUserId: null,
    profileName: null,
  });
  const conversation = await getOrCreateConversation(organizationId, contact.id);

  const waTimestamp = toDate(echo.timestamp);

  // Idempotencia dura: los mensajes ya registrados (o echoes repetidos) no
  // duplican efectos — mismo wa_message_id → sin inserción ni handoff extra.
  const msgId = newId("message");
  await db
    .insert(schema.message)
    .values({
      id: msgId,
      organizationId,
      conversationId: conversation.id,
      waMessageId: echo.id,
      direction: "out",
      type: echo.type,
      text: echo.text?.body ?? null,
      status: "sent",
      origin: "manual",
      waTimestamp,
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] });
  const [message] = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.id, msgId))
    .limit(1);
  if (!message) return; // duplicado

  const mediaInput = mediaInputFrom(echo);
  const asset = mediaInput
    ? await attachMediaAsset(organizationId, message.id, mediaInput)
    : null;

  // Solo lastMessageAt: un mensaje del negocio NUNCA abre la ventana de 24 h.
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: waTimestamp, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));

  // Pausa automática de la IA, idempotente y atómica (solo si no hay handoff).
  await db
    .update(schema.conversation)
    .set({
      aiEnabled: false,
      handoffAt: new Date(),
      handoffReason: "manual_reply",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.conversation.id, conversation.id),
        sql`${schema.conversation.handoffAt} is null`
      )
    );
  console.log(
    `[webhook] respuesta manual del dueño en ${conversation.id} — IA pausada (manual_reply)`
  );

  // La respuesta del dueño ES actividad del lead: sin esto, atender desde el
  // teléfono dejaba el pipeline con un lastActivityAt viejo y el embudo
  // mentía sobre a quién se le está siguiendo. Es seguro para el disparo de
  // inactividad porque ese usa coalesce(lastInboundAt, …) y prioriza la última
  // entrada del cliente, no la salida del negocio.
  // Un fallo al anotar actividad no debe descartar la confirmación del echo.
  try {
    await onLeadActivity(organizationId, contact.id, waTimestamp);
  } catch (err) {
    console.error(`[pipeline] no se pudo registrar actividad del contacto ${contact.id}:`, err);
  }

  publish(organizationId, {
    type: "message.new",
    data: {
      conversationId: conversation.id,
      message: serializeMessage(message, asset),
    },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });
}

/**
 * Ingesta de un mensaje entrante.
 *
 * Devuelve la conversación y el mensaje persistidos (o `null` si la fila no
 * pertenece a la organización/conversación esperada). El chat del sitio lo
 * necesita para lanzar el turno del agente DESPUÉS de contestarle al visitante,
 * sin repetir aquí la resolución de identidad.
 */
export async function ingestInboundMessage(input: {
  organizationId: string;
  identity: ResolvedIdentity;
  waMessageId: string;
  type: string;
  text: string | null;
  timestamp: string;
  media?: MediaInput | null;
  /** 014: hilo en la plataforma de origen (Zernio); null en WhatsApp. */
  threadRef?: string | null;
  suppressAi?: boolean;
  /** 016: origen del anuncio, si el mensaje vino de uno. */
  referral?: WebhookReferral | null;
}): Promise<{ conversationId: string; messageId: string } | null> {
  const db = getDb();
  const { organizationId } = input;

  const { contact } = await getOrCreateContactByIdentity(
    organizationId,
    input.identity
  );
  const conversation = await getOrCreateConversation(
    organizationId,
    contact.id,
    { channel: contact.channel as Channel, threadRef: input.threadRef ?? null }
  );

  // 016 — Si el mensaje viene de un anuncio, capturar su origen ANTES del
  // dedup de mensaje: es idempotente por sí mismo (el primer referral gana) y
  // así un reintento de Meta que llegue con el referral no lo pierde por
  // haberse cortado antes en el dedup. Solo con la bandera encendida: una
  // instancia que no atribuye no guarda identificadores de clic (ADR-001).
  if (input.referral && atribucionEnabled()) {
    await recordAttribution({
      organizationId,
      contactId: contact.id,
      conversationId: conversation.id,
      referral: input.referral,
    });
    // Y el ÚLTIMO toque en `attribution_event` (UTMs de la URL del anuncio,
    // clic, campaña). El primero ya se anotó al nacer la oportunidad.
    await recordReferralTouch({
      organizationId,
      contactId: contact.id,
      conversationId: conversation.id,
      referral: input.referral,
      occurredAt: toDate(input.timestamp),
    });
  }

  const waTimestamp = toDate(input.timestamp);

  // Idempotencia por wa_message_id. Si una ejecución anterior dejó el mensaje
  // persistido pero se cortó antes de actualizar ventana/pipeline/agente, una
  // reentrega repara esas consecuencias sin insertar otro mensaje ni sumar
  // unreadCount dos veces.
  const msgId = newId("message");
  await db
    .insert(schema.message)
    .values({
      id: msgId,
      organizationId,
      conversationId: conversation.id,
      waMessageId: input.waMessageId,
      direction: "in",
      type: input.type,
      text: input.text,
      status: "delivered",
      waTimestamp,
    })
    .onConflictDoNothing({ target: [schema.message.waMessageId] });
  const [message] = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.waMessageId, input.waMessageId))
    .limit(1);
  if (
    !message ||
    message.organizationId !== organizationId ||
    message.conversationId !== conversation.id
  ) return null;
  const isDuplicate = message.id !== msgId;

  const asset = input.media && !message.mediaAssetId
    ? await attachMediaAsset(organizationId, message.id, input.media)
    : null;

  // Los valores interpolados directamente en `sql` usan el encoder noop de
  // Drizzle. Postgres.js + el serializer transparente de Drizzle espera un
  // string para OID 1184, así que una Date cruda termina en Buffer.byteLength
  // y aborta la ingesta. Param con el encoder de timestamp la convierte a ISO.
  const timestampParam = sql.param(waTimestamp, schema.conversation.lastInboundAt);
  const conversationPatch = {
    // GREATEST: los webhooks de Meta pueden llegar fuera de orden (o
    // reintentados); sin esto un mensaje viejo retrocedía el marcador de
    // última entrada y el barrido de inactividad volvía a disparar
    // seguimientos que ya se habían cancelado.
    lastInboundAt: sql`GREATEST(COALESCE(${schema.conversation.lastInboundAt}, ${timestampParam}), ${timestampParam})`,
    lastMessageAt: sql`GREATEST(COALESCE(${schema.conversation.lastMessageAt}, ${timestampParam}), ${timestampParam})`,
    updatedAt: new Date(),
  };
  await db
    .update(schema.conversation)
    .set({
      ...conversationPatch,
      ...(!isDuplicate ? { unreadCount: sql`${schema.conversation.unreadCount} + 1` } : {}),
    })
    .where(eq(schema.conversation.id, conversation.id));

  // El número que el cliente escribe en el chat es lo único que hace
  // contactable a un prospecto de Instagram, Messenger o TikTok (sus webhooks
  // no traen teléfono) y a los de WhatsApp que entran por BSUID. Se guarda solo
  // si el contacto todavía no tiene ninguno. Tampoco puede frenar la ingesta.
  try {
    const capturado = await captureContactPhoneFromText({
      organizationId,
      contactId: contact.id,
      existingPhone: contact.phone,
      text: input.text,
    });
    if (capturado) contact.phone = capturado;
  } catch (err) {
    console.error(`[prospectos] no se pudo capturar el teléfono del contacto ${contact.id}:`, err);
  }

  // Si el pipeline tiene un problema, el mensaje entrante debe seguir hasta el
  // agente y la bandeja: no se pierde la respuesta del CRM por una side effect.
  try {
    await onLeadActivity(organizationId, contact.id, waTimestamp);
  } catch (err) {
    console.error(`[pipeline] no se pudo registrar actividad del contacto ${contact.id}:`, err);
  }

  // La ventana se acaba de reabrir: los envíos programados que esperaban al
  // cliente pueden salir ya, dentro de la nueva ventana.
  if (!isDuplicate) {
    try {
      await requeueWaitingBroadcasts(organizationId, conversation.id);
    } catch (err) {
      console.error(`[broadcasts] no se pudieron reencolar los envíos en espera de ${conversation.id}:`, err);
    }
  }

  if (!isDuplicate) {
    publish(organizationId, {
      type: "message.new",
      data: {
        conversationId: conversation.id,
        message: serializeMessage(message, asset),
      },
    });
  }
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: conversation.id } },
  });

  if (!isDuplicate) {
    publishWebhook(organizationId, "message.inbound", {
      conversationId: conversation.id,
      contactId: contact.id,
      messageId: message.id,
    });
  }

  if (!input.suppressAi) {
    if (!isDuplicate) {
      await maybeRunAgentTurn(conversation.id);
    } else {
      const [reply] = await db
        .select({ id: schema.message.id })
        .from(schema.message)
        .where(
          and(
            eq(schema.message.conversationId, conversation.id),
            eq(schema.message.direction, "out"),
            ne(schema.message.status, "failed"),
            gte(schema.message.createdAt, message.createdAt)
          )
        )
        .limit(1);
      if (!reply) await maybeRunAgentTurn(conversation.id);
    }
  }

  return { conversationId: conversation.id, messageId: message.id };
}

function toDate(timestamp: string): Date {
  const n = Number(timestamp);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000);
  return new Date();
}

/**
 * Enlace a la publicación. Instagram y TikTok no permiten reconstruirlo desde
 * el id: solo se usa el que la API guardó en `raw`. Facebook sí, porque el id
 * es `{página}_{post}`.
 */
function commentPostUrl(
  platform: "instagram" | "messenger" | "tiktok",
  postExternalId: string,
  raw: unknown
): string | null {
  const stored =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { postUrl?: unknown }).postUrl
      : null;
  if (typeof stored === "string" && /^https?:\/\//i.test(stored)) return stored;
  if (platform === "messenger") {
    const [pageId, postId] = postExternalId.split("_");
    if (pageId && postId) return `https://www.facebook.com/${pageId}/posts/${postId}`;
  }
  return null;
}

function serializeComment(
  c: typeof schema.socialComment.$inferSelect
): MessageCommentDto | null {
  if (c.platform !== "instagram" && c.platform !== "messenger" && c.platform !== "tiktok") {
    return null;
  }
  return {
    platform: c.platform,
    externalCommentId: c.externalCommentId,
    postExternalId: c.postExternalId,
    postCaption: c.postCaption,
    authorName: c.authorName,
    parentExternalId: c.parentExternalId,
    postUrl: commentPostUrl(c.platform, c.postExternalId, c.raw),
  };
}

export function serializeMessage(
  m: typeof schema.message.$inferSelect,
  media: typeof schema.mediaAsset.$inferSelect | null = null,
  comment: typeof schema.socialComment.$inferSelect | null = null
) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    direction: m.direction,
    type: m.type,
    text: m.text,
    status: m.status as MessageDto["status"],
    /** Motivo del fallo, ya traducido a algo accionable (`describeSendError`). */
    error: m.error,
    aiGenerated: m.aiGenerated,
    origin: m.origin as MessageDto["origin"],
    media: media
      ? {
          assetId: media.id,
          kind: media.kind as MessageMediaDto["kind"],
          mimeType: media.mimeType,
          fileName: media.fileName,
          fileSize: media.fileSize,
          caption: media.caption,
          fetchStatus: media.fetchStatus as MessageMediaDto["fetchStatus"],
          payload: media.payload,
        }
      : null,
    comment: comment && m.direction === "in" ? serializeComment(comment) : null,
    createdAt: (m.waTimestamp ?? m.createdAt).toISOString(),
  };
}
