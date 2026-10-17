import { apiError, withAuth } from "@/lib/api";
import { queryDashboard } from "@/server/dashboard/query";
import { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { inArray } from "drizzle-orm";
import { scoped } from "@/lib/db/tenant";
import { projectMargin } from "@/server/metrics/profitability";
import { grossMargin, grossMarginPercent } from "@/server/metrics/compute";

export const dynamic = "force-dynamic";
export const GET = withAuth(async (session, req: Request) => {
  const period = new URL(req.url).searchParams.get("period") ?? "30d";
  if (!["7d", "30d", "90d", "1y"].includes(period)) return apiError(422, "invalid_period", "Período inválido");
  const data = await queryDashboard(session.organizationId, period);

  // Márgenes por proyecto usando las funciones de profitability.
  const db = getDb();
  const orgId = session.organizationId;
  const projects = await db
    .select({ id: schema.project.id, name: schema.project.name })
    .from(schema.project)
    .where(scoped(schema.project.organizationId, orgId))
    .orderBy(schema.project.createdAt)
    .limit(50);
  const projectIds = projects.map((p) => p.id);
  const items =
    projectIds.length > 0
      ? await db
          .select()
          .from(schema.projectItem)
          .where(
            scoped(
              schema.projectItem.organizationId,
              orgId,
              inArray(schema.projectItem.projectId, projectIds)
            )
          )
      : [];
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
  const projectMargins = projects.map((project) => {
    const projectItems = items.filter((i) => i.projectId === project.id);
    const margin = projectMargin(projectItems, costMap);
    return {
      projectId: project.id,
      projectName: project.name,
      revenue: margin.revenue,
      cost: margin.cost,
      margin: margin.margin,
      marginPercent: margin.marginPercent,
      grossMargin: grossMargin(margin.revenue, margin.cost),
      grossMarginPercent: grossMarginPercent(margin.revenue, margin.cost),
    };
  });

  return Response.json({ ...data, projectMargins });
});
