import { and, desc, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const [campaign] = await db
    .select()
    .from(schema.broadcastCampaign)
    .where(scoped(schema.broadcastCampaign.organizationId, session.organizationId, eq(schema.broadcastCampaign.id, id)))
    .limit(1);
  if (!campaign) return apiError(404, "not_found", "Campaña no encontrada");

  const recipients = await db
    .select({
      id: schema.broadcastRecipient.id,
      contactId: schema.broadcastRecipient.contactId,
      contactName: schema.contact.name,
      phone: schema.contact.phone,
      status: schema.broadcastRecipient.status,
      skipReason: schema.broadcastRecipient.skipReason,
      errorCode: schema.broadcastRecipient.errorCode,
      errorMessage: schema.broadcastRecipient.errorMessage,
      sentAt: schema.broadcastRecipient.sentAt,
      deliveredAt: schema.broadcastRecipient.deliveredAt,
      readAt: schema.broadcastRecipient.readAt,
    })
    .from(schema.broadcastRecipient)
    .leftJoin(
      schema.contact,
      and(
        eq(schema.contact.id, schema.broadcastRecipient.contactId),
        eq(schema.contact.organizationId, schema.broadcastRecipient.organizationId)
      )
    )
    .where(
      scoped(
        schema.broadcastRecipient.organizationId,
        session.organizationId,
        eq(schema.broadcastRecipient.campaignId, id)
      )
    )
    .orderBy(desc(schema.broadcastRecipient.createdAt))
    .limit(1000);
  return Response.json({ campaign, recipients });
});
