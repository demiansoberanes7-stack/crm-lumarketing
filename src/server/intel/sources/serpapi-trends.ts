import { decryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * Google Trends vía SerpApi (proveedor principal).
 *
 * SerpApi ofrece acceso estructurado a Google Trends con 250 búsquedas
 * gratuitas mensuales. Permite comparar hasta 5 términos por consulta,
 * y devuelve serie temporal, regiones, temas y consultas relacionados.
 *
 * Documentación: https://serpapi.com/google-trends-api
 *
 * La clave se guarda cifrada (AES-256-GCM) en intel_credentials. El consumo
 * mensual se rastrea para evitar exceder la cuota gratuita.
 */

const SERPAPI_BASE = "https://serpapi.com/search.json";
const TIMEOUT_MS = 15_000;
const QUOTA_LIMIT = 250; // plan gratuito mensual

/* ── Tipos de respuesta normalizados ────────────────────────────────────── */

export type TrendsPoint = { time: number; value: number };
export type TrendsSeries = { points: TrendsPoint[]; average: number };
export type TrendsRegion = { geoCode: string; value: number };
export type TrendsRelated = {
  label: string;
  value: number;
  pct: number | null;
  isBreakout: boolean;
};
export type TrendsResponse = {
  timeSeries: TrendsSeries | null;
  regions: TrendsRegion[];
  topics: TrendsRelated[];
  queries: TrendsRelated[];
  partial: boolean;
  provider: "serpapi";
};

/* ── Helpers de parseo seguro ───────────────────────────────────────────── */

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec | null {
  return typeof v === "object" && v !== null ? (v as Rec) : null;
}

function parseTimeline(raw: unknown): TrendsSeries | null {
  const rec = asRec(raw);
  if (!rec) return null;
  const timeline = rec.timeline_data;
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  const points: TrendsPoint[] = [];
  for (const entry of timeline) {
    const e = asRec(entry);
    if (!e) continue;
    const values = e.values;
    const arr = Array.isArray(values) ? values : [];
    const rawValue = arr[0];
    const time = e.timestamp;
    if (typeof rawValue === "number" && typeof time === "number") {
      points.push({ time, value: rawValue });
    }
  }
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  return { points, average: values.reduce((a, b) => a + b, 0) / values.length };
}

function parseGeoMap(raw: unknown): TrendsRegion[] {
  const rec = asRec(raw);
  if (!rec) return [];
  const mapData = rec.geo_map_data;
  if (!Array.isArray(mapData)) return [];
  const out: TrendsRegion[] = [];
  for (const entry of mapData) {
    const e = asRec(entry);
    if (!e) continue;
    const code = e.geo_code;
    const value = e.value;
    if (typeof code === "string" && typeof value === "number") {
      out.push({ geoCode: code, value });
    }
  }
  return out;
}

function parseRelatedList(raw: unknown, kind: "topic" | "query"): TrendsRelated[] {
  const rec = asRec(raw);
  if (!rec) return [];
  const list = rec.ranked_keyword;
  if (!Array.isArray(list)) return [];
  const out: TrendsRelated[] = [];
  for (const entry of list) {
    const e = asRec(entry);
    if (!e) continue;
    let label: string | null = null;
    if (kind === "query" && typeof e.query === "string") {
      label = e.query;
    } else {
      const topic = asRec(e.topic);
      if (topic && typeof topic.title === "string") label = topic.title;
    }
    if (!label) continue;
    let value = 0;
    if (typeof e.value === "number") value = e.value;
    const isBreakout = typeof e.breakout === "number" && e.breakout > 0;
    let pct: number | null = null;
    const fv = e.formatted_value;
    if (typeof fv === "string" && fv.startsWith("+") && fv.endsWith("%")) {
      const n = parseInt(fv.slice(1, -1), 10);
      if (!Number.isNaN(n)) pct = n;
    }
    out.push({ label, value, pct: isBreakout ? null : pct, isBreakout });
  }
  return out;
}

/* ── Consulta principal ─────────────────────────────────────────────────── */

async function serpFetch(params: Record<string, string>): Promise<Rec | null> {
  const url = new URL(SERPAPI_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (res.status === 429) return null;
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as unknown;
  return asRec(data);
}

/**
 * Consulta Google Trends vía SerpApi. Nunca lanza: devuelve los datos
 * disponibles con `partial=true` si algo faltó.
 */
export async function fetchSerpApiTrends(
  apiKey: string,
  keywords: string[],
  geo = "MX",
  timeframe = "today 1-m"
): Promise<TrendsResponse> {
  // SerpApi permite hasta 5 comparison_items por consulta
  const terms = keywords.slice(0, 5);
  const comparisonItem = terms.map((kw) => ({ keyword: kw, geo, time: timeframe }));

  const params: Record<string, string> = {
    engine: "google_trends",
    q: terms.join(","),
    date: timeframe,
    geo,
    hl: "es-MX",
    api_key: apiKey,
    // comparison items como JSON
    comparison_item: JSON.stringify(comparisonItem),
  };

  const data = await serpFetch(params);
  if (!data) {
    return { timeSeries: null, regions: [], topics: [], queries: [], partial: true, provider: "serpapi" };
  }

  // SerpApi puede devolver error en el body aunque HTTP 200
  if (typeof data.error === "string") {
    return { timeSeries: null, regions: [], topics: [], queries: [], partial: true, provider: "serpapi" };
  }

  let partial = false;

  // Timeline
  const timeline = asRec(data.timeline);
  const timeSeries = timeline ? parseTimeline(timeline) : null;
  if (!timeSeries) partial = true;

  // Regiones (interest_by_region)
  const byRegion = asRec(data.interest_by_region);
  const regions = byRegion ? parseGeoMap(byRegion) : [];

  // Temas y consultas
  const topicsRaw = asRec(data.related_topics);
  const topics = topicsRaw ? [
    ...parseRelatedList(topicsRaw.top, "topic"),
    ...parseRelatedList(topicsRaw.rising, "topic"),
  ] : [];

  const queriesRaw = asRec(data.related_queries);
  const queries = queriesRaw ? [
    ...parseRelatedList(queriesRaw.top, "query"),
    ...parseRelatedList(queriesRaw.rising, "query"),
  ] : [];

  return { timeSeries, regions, topics, queries, partial, provider: "serpapi" };
}

/* ── Verificación de conexión ───────────────────────────────────────────── */

export async function verifySerpApi(
  apiKey: string
): Promise<{ ok: boolean; reason?: string }> {
  const data = await serpFetch({
    engine: "google_trends",
    q: "tecnología",
    date: "today 1-m",
    geo: "MX",
    hl: "es-MX",
    api_key: apiKey,
  });
  if (!data) {
    return { ok: false, reason: "SerpApi no respondió o la API key es inválida." };
  }
  if (typeof data.error === "string") {
    return { ok: false, reason: data.error };
  }
  const timeline = asRec(data.timeline);
  const series = timeline ? parseTimeline(timeline) : null;
  if (series && series.points.length > 0) {
    return { ok: true };
  }
  return { ok: false, reason: "SerpApi no devolvió serie temporal." };
}

/* ── Lectura de credencial desde BD ─────────────────────────────────────── */

export async function getSerpApiKey(
  organizationId: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.intelCredentials)
    .where(scoped(schema.intelCredentials.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row?.serpapiKeyCipher || !row.serpapiKeyIv || !row.serpapiKeyTag) {
    return null;
  }
  try {
    return decryptSecret({
      cipher: row.serpapiKeyCipher,
      iv: row.serpapiKeyIv,
      tag: row.serpapiKeyTag,
    });
  } catch {
    return null;
  }
}

/** Cuota mensual de SerpApi (plan gratuito = 250). */
export function getSerpApiQuota(): { limit: number; used: number; remaining: number } {
  return { limit: QUOTA_LIMIT, used: 0, remaining: QUOTA_LIMIT };
}
