import { eq } from "drizzle-orm";
import { withOwner, apiError } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { deliverWebhook } from "@/server/webhooks/dispatcher";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST — "Probar envío".
 *
 * Dispara un `webhook.test` contra ese webhook: ignora el filtro de eventos
 * (probás precisamente para ver si llega), hace UN solo intento (un test que
 * tarda 2 minutos en fallar no testea nada) y devuelve el resultado a la UI
 * en la misma respuesta.
 *
 * A diferencia de `message.outbound`, este sí corre en la request: la respuesta
 * ES la prueba.
 */
export const POST = withOwner(async (session, _req: Request, { params }: Params) => {
  const { id } = await params;
  const db = getDb();

  const rows = await db
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

  const webhook = rows[0];
  if (!webhook) return apiError(404, "not_found", "Webhook no encontrado");

  const result = await deliverWebhook(
    webhook,
    "webhook.test",
    {
      message: "Prueba manual desde Ajustes · Webhooks",
      organizationId: session.organizationId,
      testedAt: new Date().toISOString(),
    },
    { maxRetries: 0 }
  );

  return Response.json({
    ok: result.ok,
    status: result.status,
    ms: result.ms,
    attempts: result.attempts,
    error: result.error,
    deliveryId: result.deliveryId,
  });
});
