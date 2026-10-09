import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { serializeCampaign } from "@/server/commercial/serialize";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, session.organizationId))
    .orderBy(desc(schema.campaign.createdAt))
    .limit(200);
  return Response.json({ campaigns: rows.map(serializeCampaign) });
});

const createSchema = z.object({
  platform: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1, "Nombre requerido").max(255),
  externalId: z.string().max(255).nullable().optional(),
  objective: z.string().max(100).nullable().optional(),
  status: z.enum(["active", "paused", "completed", "archived"]).optional(),
  budgetPlannedCents: z.number().int().min(0).nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const id = newId("campaign");
  await db.insert(schema.campaign).values({
    id,
    organizationId: session.organizationId,
    platform: body.data.platform,
    name: body.data.name,
    externalId: body.data.externalId ?? null,
    objective: body.data.objective ?? null,
    status: body.data.status ?? "active",
    budgetPlannedCents: body.data.budgetPlannedCents ?? null,
    startDate: body.data.startDate ?? null,
    endDate: body.data.endDate ?? null,
  });

  const row = await db
    .select()
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, session.organizationId, eq(schema.campaign.id, id)));
  const created = row[0];
  if (!created) {
    return Response.json({ error: { code: "create_failed" } }, { status: 500 });
  }
  return Response.json({ campaign: serializeCampaign(created) }, { status: 201 });
});
