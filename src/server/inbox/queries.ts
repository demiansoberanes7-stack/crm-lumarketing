import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isHumanAgentWindowOpen, isWindowOpenFor, windowRemainingMsFor } from "@/server/inbox/window";
import { capabilitiesFor } from "@/server/channels/capabilities";
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

  return rows.map((r) => {
    // Recupera conversaciones antiguas donde el mensaje sí quedó persistido
    // pero el marcador de ventana no (p. ej. una ingesta parcial previa).
    const conversation = r.conversation.lastInboundAt || !r.effectiveLastInboundAt
      ? r.conversation
      : { ...r.conversation, lastInboundAt: r.effectiveLastInboundAt };
    return serializeConversation(conversation, r.contact, r.preview, r.stageName);
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

export async function listMessages(
  organizationId: string,
  conversationId: string,
  since?: Date
) {
  const db = getDb();
  return db
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.message.mediaAssetId, schema.mediaAsset.id)
    )
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
        since ? gt(schema.message.createdAt, since) : undefined
      )
    )
    .orderBy(schema.message.createdAt);
}

export function serializeConversation(
  c: typeof schema.conversation.$inferSelect,
  contact: typeof schema.contact.$inferSelect,
  preview: string | null = null,
  stageName: string | null = null
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
    preview,
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

  await db
    .update(schema.conversation)
    .set(set)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
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
