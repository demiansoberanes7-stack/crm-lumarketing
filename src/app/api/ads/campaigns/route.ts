import { apiError, withAuth } from "@/lib/api";
import { getMetaCampaigns, aggregateCampaigns } from "@/server/ads/query";

export const dynamic = "force-dynamic";

/**
 * Campaign Explorer: métricas reales de Meta Ads por campaña (gasto,
 * impresiones, alcance, CTR, CPC, CPM, frecuencia, conversiones, ROAS y
 * retención de reels), con total general y agregado de la selección.
 *
 * Los componentes vienen persistidos (poller); las razones se recalculan al
 * consultar para que la agregación por selección múltiple sea correcta.
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "30d";
  if (!["7d", "30d", "90d", "1y"].includes(period)) {
    return apiError(422, "invalid_period", "Período inválido");
  }
  const campaignIds = (url.searchParams.get("campaignIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = await getMetaCampaigns(session.organizationId, period);
  const selectionAggregates = aggregateCampaigns(
    result.campaigns,
    campaignIds.length > 0 ? campaignIds : undefined
  );

  return Response.json({
    campaigns: result.campaigns,
    totals: result.totals,
    selectionAggregates,
    selectedIds: campaignIds,
    connection: result.connection,
    currency: result.currency,
    period,
  });
});
