import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isHumanAgentWindowOpen, isWindowOpenFor, windowRemainingMsFor } from "@/server/inbox/window";
import { capabilitiesFor } from "@/server/channels/capabilities";
import { disabledChannelsFor } from "@/server/ai/channel-policy";
import { commentGroupKey, foldCommentThreads, parseCommentIdentity } from "@/lib/comment-thread";
import type { Channel } from "@/lib/channels";
import type { ConversationDto } from "@/lib/types";

function effectiveLastInboundAtSql() {
  const latestInbound = sql<Date | null>`(
    select coalesce(m.wa_timestamp, m.created_at)
    from message m
    where m.conversation_id = ${schema.conversation.id}
      and m.direction = 'in'
    order by coalesce(m.wa_timestamp, m.created_at) desc
    limit 1
  )`;
  return sql<Date | null>`coalesce(${schema.conversation.lastInboundAt}, ${latestInbound})`
    .mapWith(schema.conversation.lastInboundAt);
}

export async function listConversations(
  organizationId: string,
  since?: Date,
  /** 053: filtra por canal (el selector de envío de cotizaciones). */
  channel?: Channel
): Promise<ConversationDto[]> {
  const db = getDb();
  const previewSql = sql<string | null>`(
    select coalesce(m.text, m.type)
    from message m
    where m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc
    limit 1
  )`;
  const stageSql = sql<string | null>`(
    select s.name from lead l
    join pipeline_stage s on s.id = l.stage_id
    where l.contact_id = ${schema.contact.id}
    limit 1
  )`;

  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      preview: previewSql,
      stageName: stageSql,
      effectiveLastInboundAt: effectiveLastInboundAtSql(),
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        channel ? eq(schema.conversation.channel, channel) : undefined,
        since ? gt(schema.conversation.updatedAt, since) : undefined
      )
    )
    .orderBy(desc(sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`));

  const disabledChannels = await disabledChannelsFor(organizationId);
  // Una fila por PERSONA en Comentarios: las conversaciones viejas por post
  // (y la nueva por autor) se funden aquí, sin mover ni borrar filas.
  return foldCommentThreads(rows).map((r) => {
    // Recupera conversaciones antiguas donde el mensaje sí quedó persistido
    // pero el marcador de ventana no (p. ej. una ingesta parcial previa).
    const conversation = r.conversation.lastInboundAt || !r.effectiveLastInboundAt
      ? r.conversation
      : { ...r.conversation, lastInboundAt: r.effectiveLastInboundAt };
    return serializeConversation(
      conversation,
      r.contact,
      r.preview,
      r.stageName,
      !disabledChannels.includes(conversation.channel as Channel)
    );
  });
}

export async function getConversation(
  organizationId: string,
  conversationId: string
) {
  const db = getDb();
  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row || row.conversation.lastInboundAt) return row ?? null;

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
  const lastInboundAt = latestInbound?.waTimestamp ?? latestInbound?.createdAt ?? null;
  return lastInboundAt
    ? { ...row, conversation: { ...row.conversation, lastInboundAt } }
    : row;
}

/**
 * Conversaciones que forman el hilo de una PERSONA en Comentarios: la
 * representativa (la que se abrió) más las viejas, que tenían una por post.
 * Devuelve null cuando la conversación no es de Comentarios.
 */
async function commentThreadConversationIds(
  organizationId: string,
  conversationId: string
): Promise<string[] | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.conversation.id,
      identity: schema.contact.waIdentity,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        eq(schema.conversation.channel, "comments")
      )
    );
  const target = rows.find((r) => r.id === conversationId);
  if (!target) return null;
  if (!parseCommentIdentity(target.identity)) return [conversationId];
  const key = commentGroupKey(target.identity);
  const ids = rows
    .filter((r) => commentGroupKey(r.identity) === key)
    .map((r) => r.id);
  return ids.length ? ids : [conversationId];
}

export async function listMessages(
  organizationId: string,
  conversationId: string,
  since?: Date
) {
  const db = getDb();
  // El hilo de comentarios es de la persona: se cargan también los mensajes
  // de sus conversaciones viejas (una por post) para que la vista muestre la
  // historia completa aunque la fila abierta sea la más reciente.
  const groupIds = await commentThreadConversationIds(organizationId, conversationId);
  return db
    .select({
      message: schema.message,
      media: schema.mediaAsset,
      // El comentario dueño del mensaje: el id de plataforma del mensaje
      // entrante es el mismo `external_comment_id`. Es lo que permite pintar
      // la publicación y el autor sin volver a pegar el caption en el texto.
      comment: schema.socialComment,
    })
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.message.mediaAssetId, schema.mediaAsset.id)
    )
    .leftJoin(
      schema.socialComment,
      and(
        eq(schema.socialComment.organizationId, schema.message.organizationId),
        eq(schema.socialComment.externalCommentId, schema.message.providerMessageId)
      )
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        groupIds
          ? inArray(schema.message.conversationId, groupIds)
          : eq(schema.message.conversationId, conversationId),
        since ? gt(schema.message.createdAt, since) : undefined
      )
    )
    // En comentarios manda la hora del comentario, no la de ingesta: un sync
    // tardío inserta varios a la vez y `created_at` los desordenaría.
    .orderBy(
      groupIds
        ? sql`coalesce(${schema.message.waTimestamp}, ${schema.message.createdAt})`
        : schema.message.createdAt
    );
}

/**
 * Los comentarios viejos guardaron el caption de la publicación como prefijo
 * `sobre: …\n\n` dentro del texto. La lista sigue leyendo ese texto: aquí se
 * recorta para que el renglón muestre el comentario, no la cabecera repetida.
 * Los mensajes nuevos ya guardan solo el cuerpo.
 */
function cleanCommentPreview(channel: string, preview: string | null): string | null {
  if (channel !== "comments" || !preview) return preview;
  const split = preview.indexOf("\n\n");
  if (preview.startsWith("sobre: ") && split > 0) return preview.slice(split + 2);
  return preview;
}

export function serializeConversation(
  c: typeof schema.conversation.$inferSelect,
  contact: typeof schema.contact.$inferSelect,
  preview: string | null = null,
  stageName: string | null = null,
  channelAiEnabled = true
): ConversationDto {
  // Ventana según el canal, no un supuesto de WhatsApp:
  // - google_business (sin ventana): siempre enviable.
  // - human_agent_tag (IG/Messenger): enviable dentro de 24 h, y
  //   también fuera con la etiqueta HUMAN_AGENT hasta 7 días.
  // - TikTok: 48 h sin etiqueta; WhatsApp: 24 h.
  const caps = capabilitiesFor(c.channel as Channel);
  const withinWindow = caps.windowMs === null
    ? true
    : isWindowOpenFor(c.lastInboundAt, caps.windowMs);
  const humanAgentMode =
    caps.windowMs !== null &&
    caps.outsideWindow === "human_agent_tag" &&
    !withinWindow &&
    isHumanAgentWindowOpen(c.lastInboundAt);
  const windowOpen = withinWindow || humanAgentMode;
  return {
    id: c.id,
    channel: c.channel as Channel,
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    stageName,
    aiEnabled: c.aiEnabled,
    channelAiEnabled,
    handoffAt: c.handoffAt?.toISOString() ?? null,
    handoffReason: c.handoffReason,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    unreadCount: c.unreadCount,
    windowOpen,
    windowRemainingMs: caps.windowMs === null
      ? 0
      : windowRemainingMsFor(c.lastInboundAt, caps.windowMs),
    humanAgentMode,
    preview: cleanCommentPreview(c.channel, preview),
  };
}

export async function updateConversation(
  organizationId: string,
  conversationId: string,
  patch: { aiEnabled?: boolean; reactivate?: boolean; markRead?: boolean }
) {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.aiEnabled !== undefined) set.aiEnabled = patch.aiEnabled;
  if (patch.reactivate) {
    set.handoffAt = null;
    set.handoffReason = null;
    set.aiEnabled = patch.aiEnabled ?? true;
  }
  if (patch.markRead) set.unreadCount = 0;

  // Marcar leído el hilo de una persona limpia también sus conversaciones
  // viejas por post; si no, al recargar reaparecería el contador sumado.
  const markReadIds =
    patch.markRead !== undefined
      ? await commentThreadConversationIds(organizationId, conversationId)
      : null;

  await db
    .update(schema.conversation)
    .set(set)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        markReadIds
          ? inArray(schema.conversation.id, markReadIds)
          : eq(schema.conversation.id, conversationId)
      )
    );
  const [updated] = await db
    .select()
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  return updated ?? null;
}
