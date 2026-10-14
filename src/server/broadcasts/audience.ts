import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { MEDIUM_VALUES, SOCIAL_NETWORKS } from "@/lib/contact-medium";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { capabilitiesFor } from "@/server/channels/capabilities";
import { isWindowOpen, isWindowOpenFor } from "@/server/inbox/window";
import { whatsappProvider } from "@/server/whatsapp/provider";
import type { BroadcastChannel } from "@/server/broadcasts/filters";

export type BroadcastFilters = {
  stageId?: string;
  medium?: (typeof MEDIUM_VALUES)[number];
  mediumDetail?: (typeof SOCIAL_NETWORKS)[number];
  noteText?: string;
  noteDays?: number;
  /** Contactos específicos (programación individual). */
  contactIds?: string[];
};

export type BroadcastAudienceRecipient = {
  contactId: string;
  conversationId: string | null;
  channel: BroadcastChannel;
  status: "queued" | "skipped";
  skipReason: string | null;
};

export const BROADCAST_AUDIENCE_LIMIT = 5_000;

/** Motivo de omisión cuando el contacto no tiene conversación en ese canal. */
export function noConversationReason(channel: BroadcastChannel | string): string {
  // WhatsApp conserva el motivo histórico (ya hay campañas con él guardado).
  return channel === "whatsapp" ? "no_whatsapp_conversation" : `no_${channel}_conversation`;
}

/**
 * ¿Se puede enviar AHORA por ese canal? WhatsApp con WAHA ignora la ventana
 * (comportamiento histórico de la instancia); el resto respeta la ventana
 * declarada en capabilities — un envío masivo jamás sale por la etiqueta de
 * agente humano, esa es para respuestas del operador.
 */
function broadcastWindowOpen(
  channel: BroadcastChannel,
  lastInboundAt: Date | null,
  provider: "meta" | "waha" | "zernio",
  now: Date
): boolean {
  if (channel === "whatsapp") {
    return provider === "waha" || isWindowOpen(lastInboundAt, now);
  }
  const windowMs = capabilitiesFor(channel).windowMs;
  if (windowMs === null) return true;
  return isWindowOpenFor(lastInboundAt, windowMs, now);
}

export function classifyBroadcastConversation(
  conversation: {
    id: string;
    channel: string;
    isTest: boolean;
    lastInboundAt: Date | null;
  } | null,
  options: { channel: BroadcastChannel; provider: "meta" | "waha" | "zernio" },
  now: Date = new Date()
): Pick<BroadcastAudienceRecipient, "conversationId" | "status" | "skipReason"> {
  if (!conversation || conversation.channel !== options.channel || conversation.isTest) {
    return {
      conversationId: null,
      status: "skipped",
      skipReason: noConversationReason(options.channel),
    };
  }
  if (!broadcastWindowOpen(options.channel, conversation.lastInboundAt, options.provider, now)) {
    return { conversationId: conversation.id, status: "skipped", skipReason: "window_closed" };
  }
  return { conversationId: conversation.id, status: "queued", skipReason: null };
}

/** A distinct-and-scoped audience snapshot; it never sends or mutates contacts. */
export async function resolveBroadcastAudience(
  organizationId: string,
  filters: BroadcastFilters,
  channel: BroadcastChannel = "whatsapp"
): Promise<BroadcastAudienceRecipient[]> {
  const db = getDb();
  let stageContactIds: string[] | undefined;

  if (filters.stageId) {
    const [stage] = await db
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, organizationId, eq(schema.pipelineStage.id, filters.stageId)))
      .limit(1);
    if (!stage) throw new Error("La etapa seleccionada no existe en esta organización");

    const leads = await db
      .select({ contactId: schema.lead.contactId })
      .from(schema.lead)
      .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.stageId, filters.stageId)));
    stageContactIds = [...new Set(leads.map((lead) => lead.contactId))];
    if (stageContactIds.length === 0) return [];
  }

  let noteContactIds: string[] | undefined;
  if (filters.noteText || filters.noteDays) {
    const latestNotes = await db
      .selectDistinctOn([schema.contactNote.contactId], {
        contactId: schema.contactNote.contactId,
        body: schema.contactNote.body,
        createdAt: schema.contactNote.createdAt,
      })
      .from(schema.contactNote)
      .where(scoped(schema.contactNote.organizationId, organizationId))
      .orderBy(schema.contactNote.contactId, desc(schema.contactNote.createdAt));
    const since = filters.noteDays
      ? new Date(Date.now() - filters.noteDays * 24 * 60 * 60 * 1000)
      : null;
    const normalizedText = filters.noteText?.toLocaleLowerCase("es");
    noteContactIds = latestNotes
      .filter((note) =>
        (!since || note.createdAt >= since) &&
        (!normalizedText || note.body.toLocaleLowerCase("es").includes(normalizedText))
      )
      .map((note) => note.contactId);
    if (noteContactIds.length === 0) return [];
  }

  const conditions = [
    eq(schema.contact.organizationId, organizationId),
    isNull(schema.contact.archivedAt),
    filters.medium ? eq(schema.contact.medium, filters.medium) : undefined,
    filters.mediumDetail ? eq(schema.contact.mediumDetail, filters.mediumDetail) : undefined,
    stageContactIds ? inArray(schema.contact.id, stageContactIds) : undefined,
    noteContactIds ? inArray(schema.contact.id, noteContactIds) : undefined,
    filters.contactIds?.length ? inArray(schema.contact.id, filters.contactIds) : undefined,
  ];
  const contacts = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(and(...conditions))
    .orderBy(schema.contact.createdAt)
    .limit(BROADCAST_AUDIENCE_LIMIT + 1);
  if (contacts.length > BROADCAST_AUDIENCE_LIMIT) {
    throw new Error(`La segmentación supera el límite de ${BROADCAST_AUDIENCE_LIMIT} contactos por campaña`);
  }
  if (contacts.length === 0) return [];

  const contactIds = contacts.map((contact) => contact.id);
  const conversations = await db
    .select({
      id: schema.conversation.id,
      contactId: schema.conversation.contactId,
      channel: schema.conversation.channel,
      isTest: schema.conversation.isTest,
      lastInboundAt: schema.conversation.lastInboundAt,
    })
    .from(schema.conversation)
    .where(
      and(
        scoped(schema.conversation.organizationId, organizationId),
        inArray(schema.conversation.contactId, contactIds),
        eq(schema.conversation.channel, channel),
        eq(schema.conversation.isTest, false)
      )
    );
  const conversationByContact = new Map(conversations.map((conversation) => [conversation.contactId, conversation]));
  // El proveedor de WhatsApp solo decide la ventana de ese canal; los demás
  // la leen de capabilities.
  const provider = channel === "whatsapp" ? await whatsappProvider(organizationId) : "meta";
  const now = new Date();

  return contacts.map(({ id: contactId }) => {
    const conversation = conversationByContact.get(contactId);
    return {
      contactId,
      channel,
      ...classifyBroadcastConversation(conversation ?? null, { channel, provider }, now),
    };
  });
}
