import { apiError, withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import { z } from "zod";

export const dynamic = "force-dynamic";

const strategyCreateSchema = z.object({
  name: z.string().min(1).max(255),
  // nullable (no solo optional): el cliente manda null para vaciar el campo y
  // `optional()` lo descarta, dejando la descripción vieja pegada.
  description: z.string().max(2000).nullable().optional(),
  objectType: z.enum(["offer", "experiment", "campaign"]),
  objectId: z.string().min(1).max(255),
  acquisitionChannelId: z.string().max(255).nullable().optional(),
  // int4: sin max, un 1e15 llega al driver y PG revienta con 22003 (500).
  // nullable: el cliente manda null explícito para "sin objetivo".
  revenueTargetCents: z.number().int().min(0).max(2147483647).nullable().optional(),
  conversionTarget: z.number().int().min(0).max(2147483647).nullable().optional(),
  status: z.enum(["active", "paused", "completed"]).optional(),
});

/**
 * CRUD de estrategias de ventas.
 * GET    /api/strategies          → lista
 * POST   /api/strategies          → crear
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const strategies = await db
    .select()
    .from(schema.strategy)
    .where(scoped(schema.strategy.organizationId, session.organizationId))
    .orderBy(schema.strategy.createdAt);
  return Response.json({ strategies });
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await req.json().catch(() => null);
  const parsed = strategyCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(422, "invalid_body", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  const db = getDb();
  const orgId = session.organizationId;

  // FK real a acquisition_channel: un id inexistente daría 500 y uno de otra
  // organización dejaría la estrategia apuntando a un canal ajeno.
  if (parsed.data.acquisitionChannelId) {
    const [channel] = await db
      .select({ id: schema.acquisitionChannel.id })
      .from(schema.acquisitionChannel)
      .where(
        scoped(
          schema.acquisitionChannel.organizationId,
          orgId,
          eq(schema.acquisitionChannel.id, parsed.data.acquisitionChannelId)
        )
      )
      .limit(1);
    if (!channel) return apiError(422, "invalid_channel", "Canal de adquisición no válido");
  }

  const id = newId("strategy");
  await db.insert(schema.strategy).values({
    id,
    organizationId: orgId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    objectType: parsed.data.objectType,
    objectId: parsed.data.objectId,
    acquisitionChannelId: parsed.data.acquisitionChannelId ?? null,
    revenueTargetCents: parsed.data.revenueTargetCents ?? null,
    conversionTarget: parsed.data.conversionTarget ?? null,
    status: parsed.data.status ?? "active",
  });

  const [strategy] = await db
    .select()
    .from(schema.strategy)
    .where(scoped(schema.strategy.organizationId, orgId, eq(schema.strategy.id, id)))
    .limit(1);

  return Response.json({ strategy }, { status: 201 });
});
