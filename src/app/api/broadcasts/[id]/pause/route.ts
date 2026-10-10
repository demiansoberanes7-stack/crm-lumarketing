import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const [campaign] = await getDb()
    .select({ id: schema.broadcastCampaign.id, status: schema.broadcastCampaign.status })
    .from(schema.broadcastCampaign)
    .where(scoped(schema.broadcastCampaign.organizationId, session.organizationId, eq(schema.broadcastCampaign.id, id)))
    .limit(1);
  if (!campaign) return apiError(404, "not_found", "Campaña no encontrada");
  if (campaign.status !== "sending") return apiError(409, "campaign_state", "La campaña no está enviando");

  await getDb()
    .update(schema.broadcastCampaign)
    .set({ status: "paused", updatedAt: new Date() })
    .where(scoped(schema.broadcastCampaign.organizationId, session.organizationId, eq(schema.broadcastCampaign.id, id)));
  return Response.json({ ok: true, status: "paused" });
});
