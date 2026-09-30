import { eq, desc, count } from "drizzle-orm";
import { withOwner, apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET — historial de entregas de un webhook.
 *
 * Reemplaza a `GET /api/settings/outbound-webhooks/[id]/deliveries`, que vivía
 * en la superficie legada `withAuth` (cualquier miembro podía leerla). Ahora es
 * `withOwner` y además el listado va con `scoped()`, por si un id ajeno llegara
 * a colarse en el where.
 */
export const GET = withOwner(async (session, req: Request, { params }: Params) => {
  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 100);
  const offset = Math.max(Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  const db = getDb();

  const webhookRows = await db
    .select({ id: schema.outboundWebhook.id })
    .from(schema.outboundWebhook)
    .where(
      scoped(
        schema.outboundWebhook.organizationId,
        session.organizationId,
        eq(schema.outboundWebhook.id, id)
      )
    )
    .limit(1);

  if (!webhookRows[0]) return apiError(404, "not_found", "Webhook no encontrado");

  const where = scoped(
    schema.outboundDelivery.organizationId,
    session.organizationId,
    eq(schema.outboundDelivery.webhookId, id)
  );

  const [deliveries, totals] = await Promise.all([
    db
      .select({
        id: schema.outboundDelivery.id,
        event: schema.outboundDelivery.event,
        status: schema.outboundDelivery.status,
        attempts: schema.outboundDelivery.attempts,
        lastStatusCode: schema.outboundDelivery.lastStatusCode,
        lastError: schema.outboundDelivery.lastError,
        createdAt: schema.outboundDelivery.createdAt,
        deliveredAt: schema.outboundDelivery.deliveredAt,
      })
      .from(schema.outboundDelivery)
      .where(where)
      .orderBy(desc(schema.outboundDelivery.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ status: schema.outboundDelivery.status, total: count() })
      .from(schema.outboundDelivery)
      .where(where)
      .groupBy(schema.outboundDelivery.status),
  ]);

  return Response.json({
    deliveries,
    total: Object.fromEntries(totals.map((t) => [t.status, t.total])),
    limit,
    offset,
  });
});
