import { eq, desc } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** GET — obtener historial de entregas de un webhook */
export const GET = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const db = getDb();

  // Verificar que el webhook pertenece a la organización
  const webhookRows = await db
    .select()
    .from(schema.outboundWebhook)
    .where(
      scoped(
        schema.outboundWebhook.organizationId,
        session.organizationId,
        eq(schema.outboundWebhook.id, id)
      )
    )
    .limit(1);

  if (!webhookRows[0]) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const deliveries = await db
    .select()
    .from(schema.outboundDelivery)
    .where(eq(schema.outboundDelivery.webhookId, id))
    .orderBy(desc(schema.outboundDelivery.createdAt))
    .limit(limit)
    .offset(offset);

  return Response.json({
    deliveries: deliveries.map((d) => ({
      id: d.id,
      event: d.event,
      status: d.status,
      attempts: d.attempts,
      lastStatusCode: d.lastStatusCode,
      lastError: d.lastError,
      createdAt: d.createdAt,
      deliveredAt: d.deliveredAt,
    })),
    limit,
    offset,
  });
});
