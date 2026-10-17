import { apiError, withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { scoped } from "@/lib/db/tenant";
import { z } from "zod";

export const dynamic = "force-dynamic";

const strategyUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  objectType: z.enum(["offer", "experiment", "campaign"]).optional(),
  objectId: z.string().min(1).max(255).optional(),
  acquisitionChannelId: z.string().max(255).optional(),
  revenueTargetCents: z.number().int().nonnegative().optional(),
  conversionTarget: z.number().int().nonnegative().optional(),
  status: z.enum(["active", "paused", "completed"]).optional(),
});

type Params = { params: Promise<{ id: string }> };

/**
 * Operaciones individuales de estrategia.
 * PATCH  /api/strategies/[id]    → actualizar
 * DELETE /api/strategies/[id]    → eliminar
 */
export const PATCH = withAuth(async (session, req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = strategyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(422, "invalid_body", parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: schema.strategy.id })
    .from(schema.strategy)
    .where(scoped(schema.strategy.organizationId, session.organizationId, eq(schema.strategy.id, id)))
    .limit(1);
  if (!existing) return apiError(404, "not_found", "Estrategia no encontrada");

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.objectType !== undefined) updates.objectType = parsed.data.objectType;
  if (parsed.data.objectId !== undefined) updates.objectId = parsed.data.objectId;
  if (parsed.data.acquisitionChannelId !== undefined) updates.acquisitionChannelId = parsed.data.acquisitionChannelId;
  if (parsed.data.revenueTargetCents !== undefined) updates.revenueTargetCents = parsed.data.revenueTargetCents;
  if (parsed.data.conversionTarget !== undefined) updates.conversionTarget = parsed.data.conversionTarget;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;

  await db
    .update(schema.strategy)
    .set(updates)
    .where(eq(schema.strategy.id, id));

  const [strategy] = await db
    .select()
    .from(schema.strategy)
    .where(eq(schema.strategy.id, id))
    .limit(1);

  return Response.json({ strategy });
});

export const DELETE = withAuth(async (session, _req: Request, { params }: Params) => {
  const { id } = await params;
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.strategy.id })
    .from(schema.strategy)
    .where(scoped(schema.strategy.organizationId, session.organizationId, eq(schema.strategy.id, id)))
    .limit(1);
  if (!existing) return apiError(404, "not_found", "Estrategia no encontrada");

  await db.delete(schema.strategy).where(eq(schema.strategy.id, id));
  return Response.json({ ok: true });
});
