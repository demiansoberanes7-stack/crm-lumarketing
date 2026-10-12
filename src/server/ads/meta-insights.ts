import { getEnv } from "@/lib/env";

/**
 * Lector de Meta Ads Insights a nivel campaña.
 *
 * Devuelve los componentes atómicos que Meta reporta (gasto, impresiones,
 * alcance, clics, conversiones y video/reels). Las razones (CTR, CPC, CPM,
 * ROAS, frecuencia, retención) NO se calculan aquí: se recalculan al consultar
 * para que la agregación por selección múltiple sea correcta.
 *
 * El token SIEMPRE viaja en el header Authorization, nunca en la query (las
 * URLs con access_token se filtran en logs de proxies/CDNs/referers).
 */

/** Conjunto de action_type que cuentan como conversión (conteo). */
const CONVERSION_COUNT_TYPES = new Set([
  "lead",
  "purchase",
  "complete_registration",
  "offsite_conversion.fb_pixel_lead",
  "offsite_conversion.fb_pixel_purchase",
  "offsite_conversion.fb_pixel_complete_registration",
  "onsite_conversion.lead_grouped",
]);

/** Conjunto de action_type cuyo `value` es un importe (no un conteo). */
const CONVERSION_VALUE_TYPES = new Set([
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_conversion.total_purchase_value",
]);

export interface RawAction {
  action_type?: string;
  value?: string;
}

export interface NormalizedMetaCampaignInsight {
  campaignExternalId: string;
  campaignName: string | null;
  campaignObjective: string | null;
  status: string | null;
  dateStart: string | null;
  dateStop: string | null;
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
  avgWatchTimeMs: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP100: number;
  actions: RawAction[] | null;
  raw: unknown;
}

interface GraphInsight {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  unique_clicks?: string;
  actions?: RawAction[];
  action_values?: RawAction[];
  video_views?: string | RawAction[];
  thruplay_actions?: string | RawAction[];
  average_watch_time?: string;
  video_p25_watched_actions?: RawAction[];
  video_p50_watched_actions?: RawAction[];
  video_p75_watched_actions?: RawAction[];
  video_p100_watched_actions?: RawAction[];
  date_start?: string;
  date_stop?: string;
  [key: string]: unknown;
}

interface GraphCampaign {
  id?: string;
  name?: string;
  objective?: string;
  status?: string;
}

export interface MetaCredentials {
  accessToken?: string;
  adAccountId?: string;
  currency?: string;
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Suma los `value` de un arreglo de acciones que cumplan el predicado. */
function sumActions(actions: RawAction[] | undefined, predicate: (type: string) => boolean): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((total, action) => {
    const type = action?.action_type ?? "";
    return predicate(type) ? total + num(action?.value) : total;
  }, 0);
}

/** Acepta campos que Meta devuelve como string o como arreglo [{value}]. */
function firstValue(value: string | RawAction[] | undefined): number {
  if (Array.isArray(value)) return num(value[0]?.value);
  return num(value);
}

function buildGraphRoot(): string {
  const env = getEnv();
  const base = env.META_GRAPH_BASE_URL.replace(/\/+$/, "");
  const version = env.META_GRAPH_API_VERSION.replace(/^\/+|\/+$/g, "");
  return `${base}/${version}`;
}

async function graphFetch(url: URL, accessToken: string): Promise<{ ok: true; data: unknown } | { ok: false; status: number; detail: string }> {
  const response = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, status: response.status, detail: detail.slice(0, 500) };
  }
  return { ok: true, data: await response.json().catch(() => ({})) };
}

export function normalizeAccountId(raw: string): string {
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

const INSIGHT_FIELDS = [
  "campaign_id",
  "campaign_name",
  "spend",
  "impressions",
  "reach",
  "clicks",
  "unique_clicks",
  "actions",
  "action_values",
  "video_views",
  "thruplay_actions",
  "average_watch_time",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
  "date_start",
  "date_stop",
].join(",");

/**
 * Lee las insights diarias por campaña y el metadato (objetivo/estado) de las
 * campañas de la cuenta. `datePreset` controla la ventana (last_30d, etc.).
 */
export async function fetchMetaCampaignInsights(
  credentials: MetaCredentials,
  options: { datePreset?: string } = {}
): Promise<
  | { ok: true; campaigns: NormalizedMetaCampaignInsight[] }
  | { ok: false; status: number; detail: string }
> {
  const accessToken = credentials.accessToken;
  const rawAccountId = credentials.adAccountId;
  if (!accessToken || !rawAccountId) {
    return { ok: false, status: 401, detail: "Credenciales de Meta Ads incompletas (falta accessToken o adAccountId)." };
  }

  const accountId = normalizeAccountId(rawAccountId);
  const graphRoot = buildGraphRoot();
  const datePreset = options.datePreset ?? "last_30d";

  const insightsUrl = new URL(`${graphRoot}/${accountId}/insights`);
  insightsUrl.search = new URLSearchParams({
    fields: INSIGHT_FIELDS,
    level: "campaign",
    time_increment: "1",
    date_preset: datePreset,
  }).toString();

  const campaignsUrl = new URL(`${graphRoot}/${accountId}/campaigns`);
  campaignsUrl.search = new URLSearchParams({ fields: "id,name,objective,status" }).toString();

  const [insightsResult, campaignsResult] = await Promise.all([
    graphFetch(insightsUrl, accessToken),
    graphFetch(campaignsUrl, accessToken),
  ]);

  if (!insightsResult.ok) {
    return { ok: false, status: insightsResult.status, detail: insightsResult.detail };
  }

  // Metadato de campaña es best-effort: si falla, seguimos solo con las insights.
  const metaById = new Map<string, GraphCampaign>();
  if (campaignsResult.ok) {
    const payload = campaignsResult.data as { data?: GraphCampaign[] };
    for (const c of payload.data ?? []) {
      if (c.id) metaById.set(c.id, c);
    }
  }

  const payload = insightsResult.data as { data?: GraphInsight[] };
  const rows = payload.data ?? [];
  const currency = credentials.currency || "MXN";

  const campaigns = rows
    .filter((row) => typeof row.campaign_id === "string" && row.campaign_id.length > 0)
    .map((row) => {
      const meta = metaById.get(row.campaign_id!) ?? {};
      const actions = Array.isArray(row.actions) ? row.actions : null;
      return {
        campaignExternalId: row.campaign_id!,
        campaignName: row.campaign_name ?? meta.name ?? null,
        campaignObjective: meta.objective ?? null,
        status: meta.status ?? null,
        dateStart: row.date_start ?? null,
        dateStop: row.date_stop ?? null,
        currency,
        spendCents: Math.round(num(row.spend) * 100),
        impressions: num(row.impressions),
        reach: num(row.reach),
        clicks: num(row.clicks),
        uniqueClicks: num(row.unique_clicks),
        conversions: Math.round(
          sumActions(row.actions, (t) => CONVERSION_COUNT_TYPES.has(t))
        ),
        conversionValueCents: Math.round(
          sumActions(row.action_values, (t) => CONVERSION_VALUE_TYPES.has(t)) * 100
        ),
        videoViews: firstValue(row.video_views),
        thruplay: firstValue(row.thruplay_actions),
        avgWatchTimeMs: Math.round(num(row.average_watch_time) * 1000),
        videoP25: sumActions(row.video_p25_watched_actions, () => true),
        videoP50: sumActions(row.video_p50_watched_actions, () => true),
        videoP75: sumActions(row.video_p75_watched_actions, () => true),
        videoP100: sumActions(row.video_p100_watched_actions, () => true),
        actions,
        raw: row,
      } satisfies NormalizedMetaCampaignInsight;
    });

  return { ok: true, campaigns };
}
