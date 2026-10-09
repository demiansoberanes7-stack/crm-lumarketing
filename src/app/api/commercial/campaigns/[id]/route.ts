import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { serializeCampaign } from "@/server/commercial/serialize";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function getCampaign(orgId: string, id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaign)
    .where(
      scoped(schema.campaign.organizationId, orgId, eq(schema.campaign.id, id))
    );
  return rows[0] ?? null;
}

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const campaign = await getCampaign(session.organizationId, id);
  if (!campaign) return apiError(404, "not_found", "Campaña no encontrada");
  return Response.json({ campaign: serializeCampaign(campaign) });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  objective: z.string().max(100).nullable().optional(),
  status: z.enum(["active", "paused", "completed", "archived"]).optional(),
  budgetPlannedCents: z.number().int().min(0).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const campaign = await getCampaign(session.organizationId, id);
  if (!campaign) return apiError(404, "not_found", "Campaña no encontrada");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.name !== undefined) set.name = body.data.name;
  if (body.data.objective !== undefined) set.objective = body.data.objective;
  if (body.data.status !== undefined) set.status = body.data.status;
  if (body.data.budgetPlannedCents !== undefined)
    set.budgetPlannedCents = body.data.budgetPlannedCents;
  if (body.data.startDate !== undefined) set.startDate = body.data.startDate;
  if (body.data.endDate !== undefined) set.endDate = body.data.endDate;

  const db = getDb();
  await db
    .update(schema.campaign)
    .set(set)
    .where(
      scoped(schema.campaign.organizationId, session.organizationId, eq(schema.campaign.id, id))
    );

  const updated = await getCampaign(session.organizationId, id);
  if (!updated) return apiError(404, "not_found", "Campaña no encontrada");
  return Response.json({ campaign: serializeCampaign(updated) });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const campaign = await getCampaign(session.organizationId, id);
  if (!campaign) return apiError(404, "not_found", "Campaña no encontrada");

  const db = getDb();
  await db
    .delete(schema.campaign)
    .where(
      scoped(schema.campaign.organizationId, session.organizationId, eq(schema.campaign.id, id))
    );
  return Response.json({ ok: true });
});
