import { desc, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getIntegration } from "@/server/integrations";
import type { MetaCredentials } from "@/server/ads/meta-insights";

/**
 * Lectura y agregación de las insights de campañas persistidas en
 * `campaign_insight`.
 *
 * Cada fila es una campaña × día. Al consultar se SUMAN los componentes por
 * campaña (y en total) y las razones (CTR, CPC, CPM, ROAS, frecuencia,
 * retención) se RECALCULAN a partir de los componentes agregados — nunca se
 * promedian razones, porque eso produce resultados incorrectos al agregar.
 */

export interface CampaignRow {
  id: string;
  name: string;
  externalId: string;
  objective: string | null;
  status: string | null;
  currency: string;
  spendCents: number;
  impressions: number;
  reach: number;
  clicks: number;
  uniqueClicks: number;
  conversions: number;
  conversionValueCents: number;
  videoViews: number;
  thruplay: number;
  videoPlays: number;
  uniqueVideoViews: number;
  videoPlays2s: number;
  avgWatchTimeMs: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP100: number;
}

export interface AggregatedMetrics {
  spendCents: number;
  impressions: number;
  reach: number;
  clicks: number;
  uniqueClicks: number;
  conversions: number;
  conversionValueCents: number;
  videoViews: number;
  thruplay: number;
  videoPlays: number;
  uniqueVideoViews: number;
  videoPlays2s: number;
  avgWatchTimeMs: number;
  // razones recalculadas
  ctr: number | null; // clicks / impressions
  cpcCents: number | null; // spend / clicks
  cpmCents: number | null; // spend / impressions * 1000
  frequency: number | null; // impressions / reach
  roas: number | null; // conversion_value / spend
  cacCents: number | null; // spend / conversions
  // retención de reels
  videoP25Rate: number | null; // p25 / video_views
  videoP50Rate: number | null;
  videoP75Rate: number | null;
  videoP100Rate: number | null;
}

export type MetaConnectionStatus = "disconnected" | "configured" | "error";

export interface CampaignsResult {
  campaigns: CampaignRow[];
  totals: AggregatedMetrics;
  connection: { status: MetaConnectionStatus; message?: string };
  currency: string;
}

const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

function periodFrom(period: string): string {
  const days = PERIOD_DAYS[period] ?? 30;
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days);
  return from.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Componentes atómicos (sin razones) que entran a la agregación. */
type Components = {
  spendCents: number; impressions: number; reach: number; clicks: number;
  uniqueClicks: number; conversions: number; conversionValueCents: number;
  videoViews: number; thruplay: number; videoPlays: number;
  uniqueVideoViews: number; videoPlays2s: number; avgWatchTimeMs: number;
  videoP25: number; videoP50: number; videoP75: number; videoP100: number;
};

/** Recalcula todas las razones a partir de componentes ya agregados. */
export function metricsFromComponents(c: Components): AggregatedMetrics {
  const ctr = c.impressions > 0 ? c.clicks / c.impressions : null;
  const cpcCents = c.clicks > 0 ? c.spendCents / c.clicks : null;
  const cpmCents = c.impressions > 0 ? (c.spendCents / c.impressions) * 1000 : null;
  const frequency = c.reach > 0 ? c.impressions / c.reach : null;
  const roas = c.spendCents > 0 ? c.conversionValueCents / c.spendCents : null;
  const cacCents = c.conversions > 0 ? c.spendCents / c.conversions : null;
  const videoP25Rate = c.videoViews > 0 ? c.videoP25 / c.videoViews : null;
  const videoP50Rate = c.videoViews > 0 ? c.videoP50 / c.videoViews : null;
  const videoP75Rate = c.videoViews > 0 ? c.videoP75 / c.videoViews : null;
  const videoP100Rate = c.videoViews > 0 ? c.videoP100 / c.videoViews : null;
  return {
    ...c,
    ctr: ctr != null ? round2(ctr * 100) : null, // %
    cpcCents: cpcCents != null ? Math.round(cpcCents) : null,
    cpmCents: cpmCents != null ? Math.round(cpmCents) : null,
    frequency: frequency != null ? round2(frequency) : null,
    roas: roas != null ? round2(roas) : null,
    cacCents: cacCents != null ? Math.round(cacCents) : null,
    videoP25Rate: videoP25Rate != null ? round2(videoP25Rate * 100) : null,
    videoP50Rate: videoP50Rate != null ? round2(videoP50Rate * 100) : null,
    videoP75Rate: videoP75Rate != null ? round2(videoP75Rate * 100) : null,
    videoP100Rate: videoP100Rate != null ? round2(videoP100Rate * 100) : null,
  };
}

const EMPTY_COMPONENTS: Components = {
  spendCents: 0, impressions: 0, reach: 0, clicks: 0, uniqueClicks: 0,
  conversions: 0, conversionValueCents: 0, videoViews: 0, thruplay: 0,
  videoPlays: 0, uniqueVideoViews: 0, videoPlays2s: 0, avgWatchTimeMs: 0,
  videoP25: 0, videoP50: 0, videoP75: 0, videoP100: 0,
};

/** Suma componentes de un conjunto de filas y recalcula las razones. */
function aggregateComponents(rows: CampaignRow[]): AggregatedMetrics {
  const sum = { ...EMPTY_COMPONENTS };
  let watchWeighted = 0;
  for (const r of rows) {
    sum.spendCents += r.spendCents;
    sum.impressions += r.impressions;
    sum.reach += r.reach;
    sum.clicks += r.clicks;
    sum.uniqueClicks += r.uniqueClicks;
    sum.conversions += r.conversions;
    sum.conversionValueCents += r.conversionValueCents;
    sum.videoViews += r.videoViews;
    sum.thruplay += r.thruplay;
    sum.videoPlays += r.videoPlays;
    sum.uniqueVideoViews += r.uniqueVideoViews;
    sum.videoPlays2s += r.videoPlays2s;
    sum.videoP25 += r.videoP25;
    sum.videoP50 += r.videoP50;
    sum.videoP75 += r.videoP75;
    sum.videoP100 += r.videoP100;
    watchWeighted += r.avgWatchTimeMs * r.videoViews;
  }
  // Retención promedio ponderada por video_views.
  sum.avgWatchTimeMs = sum.videoViews > 0 ? Math.round(watchWeighted / sum.videoViews) : 0;
  return metricsFromComponents(sum);
}

/** Agrega las campañas seleccionadas (o todas si no se especifica). */
export function aggregateCampaigns(campaigns: CampaignRow[], selectedIds?: string[]): AggregatedMetrics {
  if (!selectedIds || selectedIds.length === 0) return aggregateComponents(campaigns);
  const selected = campaigns.filter((c) => selectedIds.includes(c.externalId));
  return aggregateComponents(selected);
}

/**
 * Lee las insights persistidas de una org en el periodo y las agrega por
 * campaña (sumando los días). Devuelve también el total general y el estado
 * de la conexión a Meta.
 */
export async function getMetaCampaigns(
  organizationId: string,
  period: string
): Promise<CampaignsResult> {
  const db = getDb();
  const from = periodFrom(period);

  const rows = await db
    .select()
    .from(schema.campaignInsight)
    .where(scoped(schema.campaignInsight.organizationId, organizationId, gte(schema.campaignInsight.dateStart, from)))
    .orderBy(desc(schema.campaignInsight.dateStart));

  // Agrupar por campaña (externalId): sumar componentes, conservar el nombre
  // y metadato más recientes. El tiempo de visualización se promedia
  // ponderado por video_views (no se promedian razones).
  const byExternal = new Map<string, CampaignRow>();
  const watchWeighted = new Map<string, number>();
  for (const row of rows) {
    const key = row.campaignExternalId;
    const existing = byExternal.get(key);
    watchWeighted.set(key, (watchWeighted.get(key) ?? 0) + row.avgWatchTimeMs * row.videoViews);
    if (!existing) {
      byExternal.set(key, {
        id: key,
        externalId: key,
        name: row.campaignName ?? "Campaña sin nombre",
        objective: row.campaignObjective,
        status: row.status,
        currency: row.currency,
        spendCents: row.spendCents,
        impressions: row.impressions,
        reach: row.reach,
        clicks: row.clicks,
        uniqueClicks: row.uniqueClicks,
        conversions: row.conversions,
        conversionValueCents: row.conversionValueCents,
        videoViews: row.videoViews,
        thruplay: row.thruplay,
        videoPlays: row.videoPlays,
        uniqueVideoViews: row.uniqueVideoViews,
        videoPlays2s: row.videoPlays2s,
        avgWatchTimeMs: row.avgWatchTimeMs,
        videoP25: row.videoP25,
        videoP50: row.videoP50,
        videoP75: row.videoP75,
        videoP100: row.videoP100,
      });
    } else {
      existing.spendCents += row.spendCents;
      existing.impressions += row.impressions;
      existing.reach += row.reach;
      existing.clicks += row.clicks;
      existing.uniqueClicks += row.uniqueClicks;
      existing.conversions += row.conversions;
      existing.conversionValueCents += row.conversionValueCents;
      existing.videoViews += row.videoViews;
      existing.thruplay += row.thruplay;
      existing.videoPlays += row.videoPlays;
      existing.uniqueVideoViews += row.uniqueVideoViews;
      existing.videoPlays2s += row.videoPlays2s;
      existing.videoP25 += row.videoP25;
      existing.videoP50 += row.videoP50;
      existing.videoP75 += row.videoP75;
      existing.videoP100 += row.videoP100;
      // El metadato más reciente gana si el actual está vacío.
      if (!existing.name || existing.name === "Campaña sin nombre") existing.name = row.campaignName ?? existing.name;
      if (!existing.objective) existing.objective = row.campaignObjective;
      if (!existing.status) existing.status = row.status;
    }
  }

  const campaigns = [...byExternal.values()].map((c) => {
    // Ponderar el tiempo de visualización por video_views al agregar días.
    const weight = watchWeighted.get(c.externalId) ?? 0;
    const avgWatchTimeMs = c.videoViews > 0 ? Math.round(weight / c.videoViews) : 0;
    return { ...c, avgWatchTimeMs };
  });

  // Ordenar por gasto descendente (la campaña más importante arriba).
  campaigns.sort((a, b) => b.spendCents - a.spendCents);

  const totals = aggregateComponents(campaigns);
  const currency = campaigns[0]?.currency ?? "MXN";

  // Estado de la conexión: solo chequeo de credenciales (no un extra call).
  const integration = await getIntegration(organizationId, "meta_ads");
  const credentials = (integration?.credentials ?? {}) as MetaCredentials;
  const configured = Boolean(credentials.accessToken && credentials.adAccountId);
  const connection = configured
    ? { status: "configured" as const }
    : { status: "disconnected" as const, message: "Conecta Meta Ads en Conexiones para ver tus campañas." };

  return { campaigns, totals, connection, currency };
}
