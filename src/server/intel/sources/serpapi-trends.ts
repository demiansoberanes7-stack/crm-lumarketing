import { decryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * Google Trends vía SerpApi (proveedor principal).
 *
 * SerpApi ofrece acceso estructurado a Google Trends con 250 búsquedas
 * gratuitas mensuales. Cada `data_type` es una consulta separada:
 *   - TIMESERIES (default) → interest_over_time.timeline_data
 *   - GEO_MAP_0            → interest_by_region[]
 *   - RELATED_TOPICS       → related_topics.{top,rising}
 *   - RELATED_QUERIES      → related_queries.{top,rising}
 *
 * La clave se guarda cifrada (AES-256-GCM) en intel_credentials.
 */

const SERPAPI_BASE = "https://serpapi.com/search.json";
const TIMEOUT_MS = 15_000;
const QUOTA_LIMIT = 250;

/* ── Tipos normalizados (mismo shape que el conector web) ───────────────── */

export type TrendsPoint = { time: number; value: number };
export type TrendsSeries = { points: TrendsPoint[]; average: number };
export type TrendsRegion = { geoCode: string; value: number };
export type TrendsRelated = {
  label: string;
  value: number;
  pct: number | null;
  isBreakout: boolean;
  /** Lista de la que salió: «Principal» (índice) o «Subiendo» (%). */
  list: "top" | "rising";
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

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Parsea `interest_over_time.timeline_data` de SerpApi. */
function parseTimeline(data: Rec): TrendsSeries | null {
  const iot = asRec(data.interest_over_time);
  if (!iot) return null;
  const timeline = iot.timeline_data;
  if (!Array.isArray(timeline) || timeline.length === 0) return null;

  const points: TrendsPoint[] = [];
  for (const raw of timeline) {
    const entry = asRec(raw);
    if (!entry) continue;
    // timestamp es string en SerpApi: "1789430400"
    const ts = num(entry.timestamp);
    // values es array de { query, value: "49", extracted_value: 49 }
    const values = Array.isArray(entry.values) ? entry.values : [];
    const first = asRec(values[0]);
    const value = first ? (num(first.extracted_value) ?? num(first.value)) : null;
    if (ts !== null && value !== null) {
      points.push({ time: ts * 1000, value }); // epoch seconds → ms
    }
  }
  if (points.length === 0) return null;
  const values = points.map((p) => p.value);
  return { points, average: values.reduce((a, b) => a + b, 0) / values.length };
}

/** Parsea `interest_by_region` (array plano) de SerpApi. */
function parseRegions(data: Rec): TrendsRegion[] {
  const ibr = data.interest_by_region;
  if (!Array.isArray(ibr)) return [];
  const out: TrendsRegion[] = [];
  for (const raw of ibr) {
    const e = asRec(raw);
    if (!e) continue;
    const geo = e.geo;
    const value = num(e.extracted_value) ?? num(e.value);
    if (typeof geo === "string" && value !== null) {
      out.push({ geoCode: geo, value });
    }
  }
  return out;
}

/** Parsea `related_topics.{top,rising}` de SerpApi. */
function parseTopics(data: Rec): TrendsRelated[] {
  const rt = asRec(data.related_topics);
  if (!rt) return [];
  const out: TrendsRelated[] = [];

  // Top: value es índice numérico
  const top = rt.top;
  if (Array.isArray(top)) {
    for (const raw of top) {
      const e = asRec(raw);
      if (!e) continue;
      const topic = asRec(e.topic);
      const title = topic?.title;
      if (typeof title !== "string") continue;
      const value = num(e.extracted_value) ?? num(e.value) ?? 0;
      out.push({ label: title, value, pct: null, isBreakout: false, list: "top" });
    }
  }

  // Rising: value es string "+400 %" o "Aumento puntual"
  const rising = rt.rising;
  if (Array.isArray(rising)) {
    for (const raw of rising) {
      const e = asRec(raw);
      if (!e) continue;
      const topic = asRec(e.topic);
      const title = topic?.title;
      if (typeof title !== "string") continue;
      const extracted = num(e.extracted_value);
      const rawValue = typeof e.value === "string" ? e.value : "";
      const isBreakout = rawValue.includes("Aumento puntual") || rawValue.toLowerCase().includes("breakout");
      const pctMatch = rawValue.match(/\+(\d+)/);
      const pct = pctMatch ? parseInt(pctMatch[1]!, 10) : null;
      out.push({
        label: title,
        value: extracted ?? 0,
        pct: isBreakout ? null : pct,
        isBreakout,
        list: "rising",
      });
    }
  }

  return out;
}

/** Parsea `related_queries.{top,rising}` de SerpApi. */
function parseQueries(data: Rec): TrendsRelated[] {
  const rq = asRec(data.related_queries);
  if (!rq) return [];
  const out: TrendsRelated[] = [];

  const top = rq.top;
  if (Array.isArray(top)) {
    for (const raw of top) {
      const e = asRec(raw);
      if (!e) continue;
      const query = e.query;
      if (typeof query !== "string") continue;
      const value = num(e.extracted_value) ?? num(e.value) ?? 0;
      out.push({ label: query, value, pct: null, isBreakout: false, list: "top" });
    }
  }

  const rising = rq.rising;
  if (Array.isArray(rising)) {
    for (const raw of rising) {
      const e = asRec(raw);
      if (!e) continue;
      const query = e.query;
      if (typeof query !== "string") continue;
      const extracted = num(e.extracted_value);
      const rawValue = typeof e.value === "string" ? e.value : "";
      const isBreakout = rawValue.includes("Aumento puntual") || rawValue.toLowerCase().includes("breakout");
      const pctMatch = rawValue.match(/\+(\d+)/);
      const pct = pctMatch ? parseInt(pctMatch[1]!, 10) : null;
      out.push({
        label: query,
        value: extracted ?? 0,
        pct: isBreakout ? null : pct,
        isBreakout,
        list: "rising",
      });
    }
  }

  return out;
}

/* ── Fetch básico ───────────────────────────────────────────────────────── */

async function serpFetch(params: Record<string, string>): Promise<Rec | null> {
  const url = new URL(SERPAPI_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as unknown;
  return asRec(data);
}

/* ── Consulta principal (hasta 5 keywords en una sola llamada) ─────────── */

/**
 * Consulta Google Trends vía SerpApi. Usa `data_type=TIMESERIES` para la
 * serie (una sola llamada para hasta 5 keywords). Las regiones y
 * relacionados se omiten aquí (son llamadas adicionales, ver
 * `fetchSerpApiRegions` y `fetchSerpApiRelated`).
 */
export async function fetchSerpApiTrends(
  apiKey: string,
  keywords: string[],
  geo = "MX",
  timeframe = "today 1-m"
): Promise<TrendsResponse> {
  const terms = keywords.slice(0, 5);
  const data = await serpFetch({
    engine: "google_trends",
    q: terms.join(","),
    date: timeframe,
    geo,
    hl: "es-MX",
    data_type: "TIMESERIES",
    api_key: apiKey,
  });

  if (!data || typeof data.error === "string") {
    return { timeSeries: null, regions: [], topics: [], queries: [], partial: true, provider: "serpapi" };
  }

  const timeSeries = parseTimeline(data);
  return {
    timeSeries,
    regions: [],
    topics: [],
    queries: [],
    partial: !timeSeries,
    provider: "serpapi",
  };
}

/** Consulta las regiones (interés por estado) vía SerpApi. 1 llamada. */
export async function fetchSerpApiRegions(
  apiKey: string,
  keyword: string,
  geo = "MX",
  timeframe = "today 1-m"
): Promise<TrendsRegion[]> {
  const data = await serpFetch({
    engine: "google_trends",
    q: keyword,
    date: timeframe,
    geo,
    hl: "es-MX",
    data_type: "GEO_MAP_0",
    api_key: apiKey,
  });
  return data ? parseRegions(data) : [];
}

/** Consulta temas y consultas relacionados. 2 llamadas (topics + queries). */
export async function fetchSerpApiRelated(
  apiKey: string,
  keyword: string,
  geo = "MX",
  timeframe = "today 1-m"
): Promise<{ topics: TrendsRelated[]; queries: TrendsRelated[] }> {
  const base = { engine: "google_trends", q: keyword, date: timeframe, geo, hl: "es-MX", api_key: apiKey };
  const [topicsData, queriesData] = await Promise.all([
    serpFetch({ ...base, data_type: "RELATED_TOPICS" }),
    serpFetch({ ...base, data_type: "RELATED_QUERIES" }),
  ]);
  return {
    topics: topicsData ? parseTopics(topicsData) : [],
    queries: queriesData ? parseQueries(queriesData) : [],
  };
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
    data_type: "TIMESERIES",
    api_key: apiKey,
  });
  if (!data) {
    return { ok: false, reason: "SerpApi no respondió. Verifica la API key." };
  }
  if (typeof data.error === "string") {
    return { ok: false, reason: data.error };
  }
  const series = parseTimeline(data);
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

/**
 * Cuota mensual de SerpApi (plan gratuito = 250). `used` viene del contador
 * real de la BD (`serpapiQueriesUsed`): la versión anterior devolvía 0 fijo y
 * podía hacer creer que nunca se había gastado nada.
 */
export function getSerpApiQuota(used = 0): { limit: number; used: number; remaining: number } {
  const clamped = Math.max(0, Math.min(Math.trunc(used), QUOTA_LIMIT));
  return { limit: QUOTA_LIMIT, used: clamped, remaining: QUOTA_LIMIT - clamped };
}
