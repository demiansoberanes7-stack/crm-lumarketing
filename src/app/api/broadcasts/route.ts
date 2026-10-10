import { desc } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { BROADCAST_AUDIENCE_LIMIT, resolveBroadcastAudience } from "@/server/broadcasts/audience";
import { createBroadcastSchema } from "@/server/broadcasts/filters";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const campaigns = await getDb()
    .select()
    .from(schema.broadcastCampaign)
    .where(scoped(schema.broadcastCampaign.organizationId, session.organizationId))
    .orderBy(desc(schema.broadcastCampaign.createdAt))
    .limit(100);
  return Response.json({ campaigns });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createBroadcastSchema);
  if (!body.ok) return body.response;

  let recipients;
  try {
    recipients = await resolveBroadcastAudience(session.organizationId, body.data.filters);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo calcular el segmento";
    return apiError(422, "broadcast_audience", message);
  }
  if (recipients.length === 0) {
    return apiError(422, "broadcast_empty", "El segmento no contiene contactos para guardar");
  }
  if (recipients.length > BROADCAST_AUDIENCE_LIMIT) {
    return apiError(422, "broadcast_limit", "El segmento supera el límite por campaña");
  }

  const db = getDb();
  const now = new Date();
  const id = newId("broadcastCampaign");
  const skippedCount = recipients.filter((recipient) => recipient.status === "skipped").length;
  await db.transaction(async (tx) => {
    await tx.insert(schema.broadcastCampaign).values({
      id,
      organizationId: session.organizationId,
      name: body.data.name,
      channel: "whatsapp",
      messageText: body.data.messageText,
      filters: body.data.filters,
      status: "draft",
      recipientCount: recipients.length,
      skippedCount,
      createdBy: session.userId,
      createdAt: now,
      updatedAt: now,
    });

    for (let offset = 0; offset < recipients.length; offset += 250) {
      await tx.insert(schema.broadcastRecipient).values(
        recipients.slice(offset, offset + 250).map((recipient) => ({
          id: newId("broadcastRecipient"),
          organizationId: session.organizationId,
          campaignId: id,
          contactId: recipient.contactId,
          conversationId: recipient.conversationId,
          channel: recipient.channel,
          status: recipient.status,
          skipReason: recipient.skipReason,
          scheduledAt: now,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }
  });

  return Response.json({
    campaign: { id, name: body.data.name, status: "draft", recipientCount: recipients.length, skippedCount },
  }, { status: 201 });
});
