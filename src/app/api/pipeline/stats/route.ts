import { count, eq, inArray } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/**
 * Métricas del embudo que pinta el Marketing Hub (Leads · Cotizados · Ganados).
 *
 * El Hub pedía `/api/pipeline/stats` y la ruta no existía: la tarjeta de
 * "Conversión del Pipeline" se quedaba girando para siempre. Ganados = leads
 * en etapas `kind = won`; cotizados = cotizaciones del negocio (una misma
 * persona puede tener varias), por eso no son subconjuntos del total de leads.
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const organizationId = session.organizationId;

  const [leadsRow, quotesRow, wonStages] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.lead)
      .where(scoped(schema.lead.organizationId, organizationId)),
    db
      .select({ value: count() })
      .from(schema.quote)
      .where(scoped(schema.quote.organizationId, organizationId)),
    db
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(
        scoped(
          schema.pipelineStage.organizationId,
          organizationId,
          eq(schema.pipelineStage.kind, "won")
        )
      ),
  ]);

  const leads = leadsRow[0]?.value ?? 0;
  const quotes = quotesRow[0]?.value ?? 0;

  const wonStageIds = wonStages.map((stage) => stage.id);
  let won = 0;
  if (leads > 0 && wonStageIds.length > 0) {
    const wonRow = await db
      .select({ value: count() })
      .from(schema.lead)
      .where(
        scoped(
          schema.lead.organizationId,
          organizationId,
          inArray(schema.lead.stageId, wonStageIds)
        )
      );
    won = wonRow[0]?.value ?? 0;
  }

  return Response.json({
    leads,
    quotes,
    won,
    conversionRate: leads > 0 ? Math.round((won / leads) * 1000) / 10 : 0,
  });
});
