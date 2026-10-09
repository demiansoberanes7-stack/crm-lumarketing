import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { serializeMarketplaceOrder } from "@/server/commercial/serialize";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.marketplaceOrder)
    .where(scoped(schema.marketplaceOrder.organizationId, session.organizationId))
    .orderBy(desc(schema.marketplaceOrder.orderedAt))
    .limit(200);
  return Response.json({ orders: rows.map(serializeMarketplaceOrder) });
});

const createSchema = z.object({
  platform: z.string().trim().min(1).max(30).optional(),
  externalId: z.string().max(255).nullable().optional(),
  orderNumber: z.string().trim().min(1, "Número de orden requerido").max(100),
  itemName: z.string().trim().min(1, "Producto requerido").max(255),
  quantity: z.number().int().min(1).optional(),
  amountCents: z.number().int().min(0),
  commissionCents: z.number().int().min(0).optional(),
  status: z.enum(["completed", "pending", "cancelled", "refunded"]).optional(),
  orderedAt: z.coerce.date().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const id = newId("marketplaceOrder");
  await db.insert(schema.marketplaceOrder).values({
    id,
    organizationId: session.organizationId,
    platform: body.data.platform ?? "mercado_libre",
    externalId: body.data.externalId ?? null,
    orderNumber: body.data.orderNumber,
    itemName: body.data.itemName,
    quantity: body.data.quantity ?? 1,
    amountCents: body.data.amountCents,
    commissionCents: body.data.commissionCents ?? 0,
    status: body.data.status ?? "completed",
    orderedAt: body.data.orderedAt ?? new Date(),
    notes: body.data.notes ?? null,
  });

  const row = await db
    .select()
    .from(schema.marketplaceOrder)
    .where(scoped(schema.marketplaceOrder.organizationId, session.organizationId, eq(schema.marketplaceOrder.id, id)));
  const created = row[0];
  if (!created) {
    return Response.json({ error: { code: "create_failed" } }, { status: 500 });
  }
  return Response.json({ order: serializeMarketplaceOrder(created) }, { status: 201 });
});
