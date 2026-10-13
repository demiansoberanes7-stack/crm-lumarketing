import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getIntegration } from "@/server/integrations";
import { ga4ConnectionState, parseGa4Credentials, readGa4Metrics, type Ga4Metrics } from "@/server/analytics/ga4";

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

export const GET = withAuth(async (session, req: Request) => {
  // Ventana del tablero (7d/30d/90d/1y); GA4 la respeta en sus reports.
  const period = new URL(req.url).searchParams.get("period") ?? "30d";
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
  const ga4Connection = ga4ConnectionState(ga4Credentials);

  const connections: Record<Source, SourceConnection> = {
    meta: { status: metaConfigured ? "configured" : "disconnected" },
    google: {
      status: googleConfigured ? "configured" : "disconnected",
      ...(googleConfigured ? { message: "Credenciales guardadas; no hay lectura de métricas activa." } : {}),
    },
    ga4: ga4Connection,
  };
  const metrics: DashboardMetric[] = [];
  const campaigns: DashboardCampaign[] = [];
  const chartData: ChartPoint[] = [];
  let ga4Metrics: Ga4Metrics | null = null;

  // GA4 sí tiene lectura real: la Data API corre del lado del servidor y su
  // fallo jamás bloquea el dashboard, solo cambia el estado de la conexión.
  // Sin service account no se intenta leer: `ga4ConnectionState` ya dejó el
  // aviso de qué falta y un intento solo produciría un error confuso.
  const ga4Parsed = parseGa4Credentials(ga4Credentials);
  if (ga4Parsed) {
    try {
      ga4Metrics = await readGa4Metrics(ga4Parsed, period);
      connections.ga4 = { status: "connected" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      connections.ga4 = { status: "error", message: detail.slice(0, 300) };
      console.error("[analytics] GA4 read failed", error);
    }
  }

  // Meta Ads: las métricas de campaña viven en el Campaign Explorer (datos
  // persistidos por el poller cada 15 min), no aquí. Este endpoint solo
  // reporta el estado de la conexión para no duplicar llamadas a Graph.
  return NextResponse.json({ metrics, campaigns, chartData, connections, ga4: ga4Metrics } satisfies DashboardData);
});
