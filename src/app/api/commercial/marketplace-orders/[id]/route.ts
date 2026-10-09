import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { serializeMarketplaceOrder } from "@/server/commercial/serialize";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function getOrder(orgId: string, id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.marketplaceOrder)
    .where(
      scoped(schema.marketplaceOrder.organizationId, orgId, eq(schema.marketplaceOrder.id, id))
    );
  return rows[0] ?? null;
}

const patchSchema = z.object({
  orderNumber: z.string().trim().min(1).max(100).optional(),
  itemName: z.string().trim().min(1).max(255).optional(),
  quantity: z.number().int().min(1).optional(),
  amountCents: z.number().int().min(0).optional(),
  commissionCents: z.number().int().min(0).optional(),
  status: z.enum(["completed", "pending", "cancelled", "refunded"]).optional(),
  orderedAt: z.coerce.date().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const order = await getOrder(session.organizationId, id);
  if (!order) return apiError(404, "not_found", "Orden no encontrada");

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.orderNumber !== undefined) set.orderNumber = body.data.orderNumber;
  if (body.data.itemName !== undefined) set.itemName = body.data.itemName;
  if (body.data.quantity !== undefined) set.quantity = body.data.quantity;
  if (body.data.amountCents !== undefined) set.amountCents = body.data.amountCents;
  if (body.data.commissionCents !== undefined) set.commissionCents = body.data.commissionCents;
  if (body.data.status !== undefined) set.status = body.data.status;
  if (body.data.orderedAt !== undefined) set.orderedAt = body.data.orderedAt;
  if (body.data.notes !== undefined) set.notes = body.data.notes;

  const db = getDb();
  await db
    .update(schema.marketplaceOrder)
    .set(set)
    .where(
      scoped(schema.marketplaceOrder.organizationId, session.organizationId, eq(schema.marketplaceOrder.id, id))
    );

  const updated = await getOrder(session.organizationId, id);
  if (!updated) return apiError(404, "not_found", "Orden no encontrada");
  return Response.json({ order: serializeMarketplaceOrder(updated) });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const order = await getOrder(session.organizationId, id);
  if (!order) return apiError(404, "not_found", "Orden no encontrada");

  const db = getDb();
  await db
    .delete(schema.marketplaceOrder)
    .where(
      scoped(schema.marketplaceOrder.organizationId, session.organizationId, eq(schema.marketplaceOrder.id, id))
    );
  return Response.json({ ok: true });
});
