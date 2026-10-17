import { apiError, withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { scoped } from "@/lib/db/tenant";
import { z } from "zod";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const strategyUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  // nullable: vaciar el campo debe poder fijarlo en null, no ser ignorado.
  description: z.string().max(2000).nullable().optional(),
  objectType: z.enum(["offer", "experiment", "campaign"]).optional(),
  objectId: z.string().min(1).max(255).optional(),
  acquisitionChannelId: z.string().max(255).nullable().optional(),
  revenueTargetCents: z.number().int().min(0).max(2147483647).nullable().optional(),
  conversionTarget: z.number().int().min(0).max(2147483647).nullable().optional(),
  status: z.enum(["active", "paused", "completed"]).optional(),
});

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
  const orgId = session.organizationId;
  const where = scoped(schema.strategy.organizationId, orgId, eq(schema.strategy.id, id));

  const [existing] = await db
    .select({ id: schema.strategy.id })
    .from(schema.strategy)
    .where(where)
    .limit(1);
  if (!existing) return apiError(404, "not_found", "Estrategia no encontrada");

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

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  // `"campo" in data` en vez de `!== undefined`: JSON.stringify ELIMINA las
  // claves con undefined, así que el cliente no puede distinguir "no tocar"
  // de "vaciar" salvo mandando null explícito.
  if ("name" in parsed.data) updates.name = parsed.data.name;
  if ("description" in parsed.data) updates.description = parsed.data.description ?? null;
  if ("objectType" in parsed.data) updates.objectType = parsed.data.objectType;
  if ("objectId" in parsed.data) updates.objectId = parsed.data.objectId;
  if ("acquisitionChannelId" in parsed.data) updates.acquisitionChannelId = parsed.data.acquisitionChannelId ?? null;
  if ("revenueTargetCents" in parsed.data) updates.revenueTargetCents = parsed.data.revenueTargetCents ?? null;
  if ("conversionTarget" in parsed.data) updates.conversionTarget = parsed.data.conversionTarget ?? null;
  if ("status" in parsed.data) updates.status = parsed.data.status;

  // Mismo escopo que el SELECT de arriba: check-escopito / mutar-sin-escopitar
  // es exactamente lo que prohíbe la regla multi-tenant.
  await db.update(schema.strategy).set(updates).where(where);

  const [strategy] = await db
    .select()
    .from(schema.strategy)
    .where(where)
    .limit(1);

  return Response.json({ strategy });
});

export const DELETE = withAuth(async (session, _req: Request, { params }: Params) => {
  const { id } = await params;
  const db = getDb();
  const where = scoped(schema.strategy.organizationId, session.organizationId, eq(schema.strategy.id, id));

  const [existing] = await db
    .select({ id: schema.strategy.id })
    .from(schema.strategy)
    .where(where)
    .limit(1);
  if (!existing) return apiError(404, "not_found", "Estrategia no encontrada");

  await db.delete(schema.strategy).where(where);
  return Response.json({ ok: true });
});
