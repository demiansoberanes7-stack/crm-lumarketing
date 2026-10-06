import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getIntegration } from "@/server/integrations";
import { parseGa4Credentials, readGa4Metrics, type Ga4Metrics } from "@/server/analytics/ga4";

export const dynamic = "force-dynamic";

type Source = "google" | "meta" | "ga4";
type ConnectionStatus = "disconnected" | "configured" | "connected" | "error";
type DashboardMetric = {
  source: Source;
  spend: number;
  impressions: number;
  clicks: number;
  currency: string;
};
type DashboardCampaign = DashboardMetric & { id: string; name: string };
type ChartPoint = { name: string; meta: number };
type MetaInsight = {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  date_start?: string;
};
type SourceConnection = { status: ConnectionStatus; message?: string };
type DashboardData = {
  metrics: DashboardMetric[];
  campaigns: DashboardCampaign[];
  chartData: ChartPoint[];
  connections: Record<Source, SourceConnection>;
  ga4: Ga4Metrics | null;
};

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function amount(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readMetaInsights(url: URL): Promise<{ ok: true; data: MetaInsight[] } | { ok: false; status: number; detail: string }> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, status: response.status, detail: detail.slice(0, 500) };
  }
  const payload = (await response.json()) as { data?: MetaInsight[] };
  return { ok: true, data: payload.data ?? [] };
}

export const GET = withAuth(async (session) => {
  const orgId = session.organizationId;
  const [metaIntegration, googleIntegration, ga4Integration] = await Promise.all([
    getIntegration(orgId, "meta_ads"),
    getIntegration(orgId, "google_ads"),
    getIntegration(orgId, "ga4"),
  ]);
  const metaCredentials = metaIntegration?.credentials ?? {};
  const googleCredentials = googleIntegration?.credentials ?? {};
  const ga4Credentials = ga4Integration?.credentials ?? {};

  const metaConfigured = hasText(metaCredentials.accessToken) && hasText(metaCredentials.adAccountId);
  const googleConfigured = [
    googleCredentials.customerId,
    googleCredentials.developerToken,
    googleCredentials.clientId,
    googleCredentials.clientSecret,
  ].every(hasText);
  const ga4Configured = hasText(ga4Credentials.propertyId) &&
    (hasText(ga4Credentials.serviceAccountJson) || hasText(ga4Credentials.serviceAccountKey));

  const connections: Record<Source, SourceConnection> = {
    meta: { status: metaConfigured ? "configured" : "disconnected" },
    google: {
      status: googleConfigured ? "configured" : "disconnected",
      ...(googleConfigured ? { message: "Credenciales guardadas; no hay lectura de métricas activa." } : {}),
    },
    ga4: { status: ga4Configured ? "configured" : "disconnected" },
  };
  const metrics: DashboardMetric[] = [];
  const campaigns: DashboardCampaign[] = [];
  const chartData: ChartPoint[] = [];
  let ga4Metrics: Ga4Metrics | null = null;

  // GA4 sí tiene lectura real: la Data API corre del lado del servidor y su
  // fallo jamás bloquea el dashboard, solo cambia el estado de la conexión.
  if (ga4Configured) {
    const credentials = parseGa4Credentials(ga4Credentials);
    if (!credentials) {
      connections.ga4 = { status: "error", message: "Credenciales de GA4 incompletas o inválidas." };
    } else {
      try {
        ga4Metrics = await readGa4Metrics(credentials);
        connections.ga4 = { status: "connected" };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        connections.ga4 = { status: "error", message: detail.slice(0, 300) };
        console.error("[analytics] GA4 read failed", error);
      }
    }
  }

  if (metaConfigured) {
    const token = metaCredentials.accessToken as string;
    const rawAccountId = metaCredentials.adAccountId as string;
    const accountId = rawAccountId.startsWith("act_") ? rawAccountId : `act_${rawAccountId}`;
    const campaignUrl = new URL(`https://graph.facebook.com/v19.0/${accountId}/insights`);
    campaignUrl.search = new URLSearchParams({
      fields: "campaign_id,campaign_name,spend,impressions,clicks",
      date_preset: "last_30d",
      level: "campaign",
      access_token: token,
    }).toString();
    const dailyUrl = new URL(`https://graph.facebook.com/v19.0/${accountId}/insights`);
    dailyUrl.search = new URLSearchParams({
      fields: "date_start,clicks",
      date_preset: "last_30d",
      level: "account",
      time_increment: "1",
      access_token: token,
    }).toString();

    try {
      const [campaignResult, dailyResult] = await Promise.all([
        readMetaInsights(campaignUrl),
        readMetaInsights(dailyUrl),
      ]);
      if (!campaignResult.ok) {
        connections.meta = {
          status: "error",
          message: `Meta Graph API respondió ${campaignResult.status}: ${campaignResult.detail || "sin detalle"}`,
        };
        console.error("[analytics] Meta campaign insights failed", campaignResult.status, campaignResult.detail);
      } else {
        const normalizedCampaigns = campaignResult.data.map((campaign, index) => ({
          id: campaign.campaign_id || `${campaign.campaign_name || "meta-campaign"}-${index}`,
          name: campaign.campaign_name || "Campaña sin nombre",
          source: "meta" as const,
          spend: amount(campaign.spend),
          impressions: amount(campaign.impressions),
          clicks: amount(campaign.clicks),
          currency: "MXN",
        }));
        campaigns.push(...normalizedCampaigns);
        if (campaignResult.data.length > 0) {
          metrics.push({
            source: "meta",
            spend: normalizedCampaigns.reduce((total, campaign) => total + campaign.spend, 0),
            impressions: normalizedCampaigns.reduce((total, campaign) => total + campaign.impressions, 0),
            clicks: normalizedCampaigns.reduce((total, campaign) => total + campaign.clicks, 0),
            currency: "MXN",
          });
        }
        connections.meta = { status: "connected" };
      }

      if (!dailyResult.ok) {
        console.error("[analytics] Meta daily insights failed", dailyResult.status, dailyResult.detail);
      } else {
        chartData.push(...dailyResult.data
          .filter((day) => hasText(day.date_start))
          .map((day) => ({
            name: new Date(`${day.date_start}T00:00:00Z`).toLocaleDateString("es-MX", {
              day: "2-digit",
              month: "short",
              timeZone: "UTC",
            }),
            meta: amount(day.clicks),
          })));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      connections.meta = { status: "error", message: `No se pudo consultar Meta Ads: ${detail.slice(0, 300)}` };
      console.error("[analytics] Meta insights request failed", error);
    }
  }

  return NextResponse.json({ metrics, campaigns, chartData, connections, ga4: ga4Metrics } satisfies DashboardData);
});
