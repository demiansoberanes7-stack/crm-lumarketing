import { apiError, withAuth } from "@/lib/api";
import { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { eq, gte, lte, inArray, isNotNull } from "drizzle-orm";
import { scoped } from "@/lib/db/tenant";
import { projectMargin, campaignBudgetVariance } from "@/server/metrics/profitability";
import { grossMargin, grossMarginPercent } from "@/server/metrics/compute";

export const dynamic = "force-dynamic";

/**
 * Rentabilidad: márgenes por proyecto y campaña.
 * GET /api/metrics/profitability?period=30d&projectId=xxx
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "30d";
  if (!["7d", "30d", "90d", "1y"].includes(period)) {
    return apiError(422, "invalid_period", "Período inválido");
  }
  const projectId = url.searchParams.get("projectId")?.trim() || null;

  const db = getDb();
  const orgId = session.organizationId;

  const now = new Date();
  const daysMap: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
  const days = daysMap[period] ?? 30;
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  // campaignInsight.dateStart es columna `date`: drizzle la compara con string
  // 'YYYY-MM-DD', no con Date.
  const sinceDay = since.toISOString().slice(0, 10);
  const untilDay = now.toISOString().slice(0, 10);

  // 1. Proyectos
  const projects = await db
    .select({ id: schema.project.id, name: schema.project.name })
    .from(schema.project)
    .where(
      scoped(schema.project.organizationId, orgId, projectId ? eq(schema.project.id, projectId) : undefined)
    )
    .orderBy(schema.project.createdAt)
    .limit(100);

  // 2. Items de los proyectos
  const projectIds = projects.map((p) => p.id);
  const items =
    projectIds.length > 0
      ? await db
          .select()
          .from(schema.projectItem)
          .where(
            scoped(schema.projectItem.organizationId, orgId, inArray(schema.projectItem.projectId, projectIds))
          )
      : [];

  // 3. Costos de servicio (catalogProductId → costCents)
  const productIds = [...new Set(items.map((i) => i.productId).filter((id): id is string => Boolean(id)))];
  const costs =
    productIds.length > 0
      ? await db
          .select()
          .from(schema.serviceCost)
          .where(
            scoped(
              schema.serviceCost.organizationId,
              orgId,
              inArray(schema.serviceCost.catalogProductId, productIds)
            )
          )
      : [];
  const costMap = new Map<string, number>();
  for (const cost of costs) {
    if (cost.catalogProductId) costMap.set(cost.catalogProductId, cost.costCents);
  }

  // 4. Margen por proyecto. margin negativo = pérdida real, se devuelve igual:
  // el cliente lo pinta con el badge de advertencia, y null queda reservado
  // para "no hay datos" (revenue y cost siempre existen, son 0 por defecto).
  const projectMargins = projects.map((project) => {
    const projectItems = items.filter((i) => i.projectId === project.id);
    const margin = projectMargin(projectItems, costMap);
    return {
      projectId: project.id,
      projectName: project.name,
      revenue: margin.revenue,
      cost: margin.cost,
      // null solo cuando el proyecto no tiene nada que medir; una pérdida
      // (cost > revenue) es un número negativo y el cliente la pinta en rojo.
      margin: margin.margin,
      marginPercent: margin.marginPercent,
      grossMargin: grossMargin(margin.revenue, margin.cost),
      grossMarginPercent: grossMarginPercent(margin.revenue, margin.cost),
    };
  });

  // 5. Campañas: NO se filtran por createdAt — una campaña creada hace 60 días
  // que sigue gastando dentro del período debe aparecer. El eje temporal del
  // informe es el del gasto (campaignInsight.dateStart), aplicado abajo.
  const campaigns = await db
    .select()
    .from(schema.campaign)
    .where(scoped(schema.campaign.organizationId, orgId, isNotNull(schema.campaign.externalId)))
    .orderBy(schema.campaign.createdAt)
    .limit(200);

  const campaignExternalIds = campaigns.map((c) => c.externalId).filter((id): id is string => Boolean(id));
  const insights =
    campaignExternalIds.length > 0
      ? await db
          .select()
          .from(schema.campaignInsight)
          .where(
            scoped(
              schema.campaignInsight.organizationId,
              orgId,
              inArray(schema.campaignInsight.campaignExternalId, campaignExternalIds),
              gte(schema.campaignInsight.dateStart, sinceDay),
              lte(schema.campaignInsight.dateStart, untilDay)
            )
          )
      : [];

  const campaignMargins = campaigns.map((campaign) => {
    const campaignInsights = campaign.externalId
      ? insights.filter((i) => i.campaignExternalId === campaign.externalId)
      : [];
    const actualSpend = campaignInsights.reduce((sum, i) => sum + i.spendCents, 0);
    const plannedSpend = campaign.budgetPlannedCents ?? 0;
    const variance = campaignBudgetVariance(plannedSpend, actualSpend);
    const revenue = campaignInsights.reduce((sum, i) => sum + i.conversionValueCents, 0);
    const cost = actualSpend;
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      plannedSpend,
      actualSpend,
      variance,
      revenue,
      cost,
      // null SOLO si la campaña no tuvo ni un insight en el período (no hay
      // datos). Si hubo actividad, un margen negativo es una pérdida real y
      // se devuelve igual — esconde una pérdida como "sin datos" sería mentir.
      margin: campaignInsights.length === 0 ? null : revenue - cost,
      marginPercent: revenue > 0 ? ((revenue - cost) / revenue) * 100 : null,
    };
  });

  return Response.json({ period, projectMargins, campaignMargins });
});
