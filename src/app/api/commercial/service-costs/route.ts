import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { serializeServiceCost } from "@/server/commercial/serialize";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.serviceCost)
    .where(scoped(schema.serviceCost.organizationId, session.organizationId))
    .orderBy(desc(schema.serviceCost.createdAt))
    .limit(200);
  return Response.json({ serviceCosts: rows.map(serializeServiceCost) });
});

const createSchema = z.object({
  service: z.string().max(100).nullable().optional(),
  name: z.string().trim().min(1, "Nombre requerido").max(255),
  costCents: z.number().int().min(0),
  effectiveFrom: z.coerce.date().nullable().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const id = newId("serviceCost");
  await db.insert(schema.serviceCost).values({
    id,
    organizationId: session.organizationId,
    service: body.data.service ?? null,
    name: body.data.name,
    costCents: body.data.costCents,
    effectiveFrom: body.data.effectiveFrom ?? null,
    effectiveTo: body.data.effectiveTo ?? null,
    notes: body.data.notes ?? null,
  });

  const row = await db
    .select()
    .from(schema.serviceCost)
    .where(scoped(schema.serviceCost.organizationId, session.organizationId, eq(schema.serviceCost.id, id)));
  const created = row[0];
  if (!created) {
    return Response.json({ error: { code: "create_failed" } }, { status: 500 });
  }
  return Response.json({ serviceCost: serializeServiceCost(created) }, { status: 201 });
});
