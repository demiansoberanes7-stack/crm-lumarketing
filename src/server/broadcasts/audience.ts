import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { MEDIUM_VALUES, SOCIAL_NETWORKS } from "@/lib/contact-medium";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isWindowOpen } from "@/server/inbox/window";
import { whatsappProvider } from "@/server/whatsapp/provider";

export type BroadcastFilters = {
  stageId?: string;
  medium?: (typeof MEDIUM_VALUES)[number];
  mediumDetail?: (typeof SOCIAL_NETWORKS)[number];
  noteText?: string;
  noteDays?: number;
};

export type BroadcastAudienceRecipient = {
  contactId: string;
  conversationId: string | null;
  channel: "whatsapp";
  status: "queued" | "skipped";
  skipReason: string | null;
};

export const BROADCAST_AUDIENCE_LIMIT = 5_000;

export function classifyBroadcastConversation(
  conversation: {
    id: string;
    channel: string;
    isTest: boolean;
    lastInboundAt: Date | null;
  } | null,
  provider: "meta" | "waha" | "zernio",
  now: Date = new Date()
): Pick<BroadcastAudienceRecipient, "conversationId" | "status" | "skipReason"> {
  if (!conversation || conversation.channel !== "whatsapp" || conversation.isTest) {
    return { conversationId: null, status: "skipped", skipReason: "no_whatsapp_conversation" };
  }
  if (provider !== "waha" && !isWindowOpen(conversation.lastInboundAt, now)) {
    return { conversationId: conversation.id, status: "skipped", skipReason: "window_closed" };
  }
  return { conversationId: conversation.id, status: "queued", skipReason: null };
}

/** A distinct-and-scoped audience snapshot; it never sends or mutates contacts. */
export async function resolveBroadcastAudience(
  organizationId: string,
  filters: BroadcastFilters
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
        eq(schema.conversation.channel, "whatsapp"),
        eq(schema.conversation.isTest, false)
      )
    );
  const conversationByContact = new Map(conversations.map((conversation) => [conversation.contactId, conversation]));
  const provider = await whatsappProvider(organizationId);
  const now = new Date();

  return contacts.map(({ id: contactId }) => {
    const conversation = conversationByContact.get(contactId);
    return {
      contactId,
      channel: "whatsapp",
      ...classifyBroadcastConversation(conversation ?? null, provider, now),
    };
  });
}
