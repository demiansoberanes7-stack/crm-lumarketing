import { count, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { StageKind } from "@/lib/types";

/**
 * Embudo comercial a partir de las tablas del CRM (lead, pipeline_stage,
 * lead_stage_event). Fuente: base de datos propia — sin terceros.
 *
 * Honestidad metodológica:
 * - `leadCount` = reparto ACTUAL de leads por etapa (snapshot), no cohortes.
 * - `conversionPct` entre etapas adyacentes = proxy del reparto actual
 *   (n_etapa_i+1 / n_etapa_i); NO es una tasa de conversión histórica.
 * - `eventsInWindow` = eventos `lead_stage_event` que entraron a la etapa
 *   en la ventana (movimiento real, con fecha).
 */

export type FunnelStage = {
  id: string;
  name: string;
  position: number;
  kind: StageKind;
  leadCount: number;
  /** % de los leads totales que están en esta etapa. */
  pctOfTotal: number;
  /** Conversión al paso siguiente (proxy del reparto actual). */
  conversionPct: number | null;
  /** Eventos que entraron a esta etapa en la ventana. */
  eventsInWindow: number;
};

export type CommercialFunnel = {
  totalLeads: number;
  windowDays: number;
  eventsTotalInWindow: number;
  wonLeads: number;
  lostLeads: number;
  stages: FunnelStage[];
  generatedAt: string;
};

export async function getCommercialFunnel(
  organizationId: string,
  windowDays = 90
): Promise<CommercialFunnel> {
  const db = getDb();
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(schema.pipelineStage.position);

  const leadCounts = await db
    .select({ stageId: schema.lead.stageId, value: count() })
    .from(schema.lead)
    .where(scoped(schema.lead.organizationId, organizationId))
    .groupBy(schema.lead.stageId);

  const eventCounts = await db
    .select({ stageId: schema.leadStageEvent.toStageId, value: count() })
    .from(schema.leadStageEvent)
    .where(
      scoped(
        schema.leadStageEvent.organizationId,
        organizationId,
        gte(schema.leadStageEvent.occurredAt, windowStart)
      )
    )
    .groupBy(schema.leadStageEvent.toStageId);

  const leadsByStage = new Map(leadCounts.map((r) => [r.stageId, r.value]));
  const eventsByStage = new Map(
    eventCounts.filter((r) => r.stageId !== null).map((r) => [r.stageId!, r.value])
  );
  const totalLeads = leadCounts.reduce((a, r) => a + r.value, 0);
  const eventsTotalInWindow = eventCounts.reduce((a, r) => a + r.value, 0);

  const funnelStages: FunnelStage[] = stages.map((stage, i) => {
    const leadCount = leadsByStage.get(stage.id) ?? 0;
    const next = stages[i + 1];
    const nextCount = next ? (leadsByStage.get(next.id) ?? 0) : 0;
    return {
      id: stage.id,
      name: stage.name,
      position: stage.position,
      kind: stage.kind as StageKind,
      leadCount,
      pctOfTotal: totalLeads > 0 ? (leadCount / totalLeads) * 100 : 0,
      conversionPct: next && leadCount > 0 ? (nextCount / leadCount) * 100 : null,
      eventsInWindow: eventsByStage.get(stage.id) ?? 0,
    };
  });

  const wonLeads = funnelStages
    .filter((s) => s.kind === "won")
    .reduce((a, s) => a + s.leadCount, 0);
  const lostLeads = funnelStages
    .filter((s) => s.kind === "lost")
    .reduce((a, s) => a + s.leadCount, 0);

  return {
    totalLeads,
    windowDays,
    eventsTotalInWindow,
    wonLeads,
    lostLeads,
    stages: funnelStages,
    generatedAt: new Date().toISOString(),
  };
}
