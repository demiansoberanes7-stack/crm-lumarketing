import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { serializeServiceCost } from "@/server/commercial/serialize";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function getCost(orgId: string, id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.serviceCost)
    .where(
      scoped(schema.serviceCost.organizationId, orgId, eq(schema.serviceCost.id, id))
    );
  return rows[0] ?? null;
}

const patchSchema = z.object({
  service: z.string().max(100).nullable().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  costCents: z.number().int().min(0).optional(),
  effectiveFrom: z.coerce.date().nullable().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const cost = await getCost(session.organizationId, id);
  if (!cost) return apiError(404, "not_found", "Costo no encontrado");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.service !== undefined) set.service = body.data.service;
  if (body.data.name !== undefined) set.name = body.data.name;
  if (body.data.costCents !== undefined) set.costCents = body.data.costCents;
  if (body.data.effectiveFrom !== undefined) set.effectiveFrom = body.data.effectiveFrom;
  if (body.data.effectiveTo !== undefined) set.effectiveTo = body.data.effectiveTo;
  if (body.data.notes !== undefined) set.notes = body.data.notes;

  const db = getDb();
  await db
    .update(schema.serviceCost)
    .set(set)
    .where(
      scoped(schema.serviceCost.organizationId, session.organizationId, eq(schema.serviceCost.id, id))
    );

  const updated = await getCost(session.organizationId, id);
  if (!updated) return apiError(404, "not_found", "Costo no encontrado");
  return Response.json({ serviceCost: serializeServiceCost(updated) });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const cost = await getCost(session.organizationId, id);
  if (!cost) return apiError(404, "not_found", "Costo no encontrado");

  const db = getDb();
  await db
    .delete(schema.serviceCost)
    .where(
      scoped(schema.serviceCost.organizationId, session.organizationId, eq(schema.serviceCost.id, id))
    );
  return Response.json({ ok: true });
});
