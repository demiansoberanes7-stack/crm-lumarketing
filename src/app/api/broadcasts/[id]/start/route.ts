import { and, eq, inArray } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const [campaign] = await db
    .select({ id: schema.broadcastCampaign.id, status: schema.broadcastCampaign.status })
    .from(schema.broadcastCampaign)
    .where(scoped(schema.broadcastCampaign.organizationId, session.organizationId, eq(schema.broadcastCampaign.id, id)))
    .limit(1);
  if (!campaign) return apiError(404, "not_found", "Campaña no encontrada");
  if (campaign.status !== "draft" && campaign.status !== "paused") {
    return apiError(409, "campaign_state", "Solo se pueden iniciar campañas en borrador o pausadas");
  }

  const [pending] = await db
    .select({ id: schema.broadcastRecipient.id })
    .from(schema.broadcastRecipient)
    .where(
      and(
        scoped(schema.broadcastRecipient.organizationId, session.organizationId, eq(schema.broadcastRecipient.campaignId, id)),
        eq(schema.broadcastRecipient.status, "queued")
      )
    )
    .limit(1);
  if (!pending) return apiError(409, "campaign_empty", "La campaña no tiene destinatarios elegibles pendientes");

  const now = new Date();
  const [started] = await db
    .update(schema.broadcastCampaign)
    .set({ status: "sending", startedAt: now, updatedAt: now })
    .where(
      and(
        scoped(
          schema.broadcastCampaign.organizationId,
          session.organizationId,
          eq(schema.broadcastCampaign.id, id)
        ),
        inArray(schema.broadcastCampaign.status, ["draft", "paused"])
      )
    )
    .returning({ id: schema.broadcastCampaign.id });
  if (!started) return apiError(409, "campaign_state", "La campaña ya cambió de estado");
  return Response.json({ ok: true, status: "sending" });
});
