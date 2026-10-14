/**
 * Google Trends — endpoints no oficiales (misma superficie que usa pytrends).
 *
 * NO es una API oficial de Google: no hay API key, se accede a los mismos
 * endpoints públicos de `trends.google.com/trends/api/*` que consume la
 * librería pytrends. Es UNPROBADO y puede cambiar cuando Google lo decida:
 * por eso es degradación obligatoria — si falla o cambia, el módulo sigue
 * funcionando con fallback a vistas de YouTube (camino sin dependencia
 * externa, regla de soberanía). Nunca lanza: siempre devuelve null/vacío.
 *
 * Rate limit manual: 1 petición cada 2 segundos (evita el bloqueo 429 de
 * Google). Cache en memoria 1 hora por (kw, geo, timeframe).
 *
 * ADR-001: esta fuente solo se activa con la bandera INTEL_GT.
 */

const BASE = "https://trends.google.com/trends/api";

/** User-Agent de navegador real (Google rechaza UA genéricos de fetch). */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const TIMEOUT_MS = 8000;
const RATE_LIMIT_MS = 2000;
const CACHE_TTL_MS = 60 * 60 * 1000;

/* ── Rate limit + cache ─────────────────────────────────────────────────── */

let lastRequestAt = 0;
const cache = new Map<string, { at: number; data: GtResponse }>();

/** Cookie NID de sesión: sin ella Google responde 429 a las APIs de Trends. */
let nidCookie: string | null = null;

async function ensureNidCookie(): Promise<string | null> {
  if (nidCookie) return nidCookie;
  try {
    const home = await fetch("https://trends.google.com/trends/?geo=MX", {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": UA },
      redirect: "follow",
    });
    const setCookies = home.headers.getSetCookie?.() ?? [];
    const nid = setCookies
      .map((c) => c.split(";")[0] ?? "")
      .find((c) => c.startsWith("NID="));
    if (nid) nidCookie = nid;
    return nidCookie;
  } catch {
    return null;
  }
}

function cacheKey(parts: string[]): string {
  return parts.join("|");
}

async function rateLimitedFetch(path: string): Promise<unknown> {
  const now = Date.now();
  const waitMs = lastRequestAt + RATE_LIMIT_MS - now;
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
  lastRequestAt = Date.now();

  const cookie = await ensureNidCookie();
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
  } catch {
    return null;
  }
  if (response.status === 429) {
    // Cookie vencida o rate limit: la descartamos para reintentar con una nueva.
    nidCookie = null;
    return null;
  }
  if (!response.ok) return null;

  // Google antepone ")]}'" (XSSI guard) a toda respuesta JSON.
  const text = await response.text();
  const cleaned = text.replace(/^\)\]\}'\s*\n?/, "");
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    return null;
  }
}

/* ── Tipos de respuesta (parciales: solo lo que usamos) ─────────────────── */

export type GtPoint = {
  /** Timestamp epoch ms. */
  time: number;
  /** Índice 0–100 de Google Trends para el término. */
  value: number;
};

export type GtTimeSeries = {
  points: GtPoint[];
  /** Promedio de la serie (para el índice 0–100 relativo). */
  average: number;
};

export type GtRegion = {
  /** Clave del geo de Google (código ISO o nombre). */
  geoCode: string;
  /** Índice 0–100. */
  value: number;
};

export type GtRelated = {
  /** Texto del tema/consulta. */
  label: string;
  /** Índice 0–100 (top) o valor del rising. */
  value: number;
  /** Cambio % si es rising; null si es breakout o top. */
  pct: number | null;
  /** Google lo marcó "breakout" → la UI muestra "Aumento puntual". */
  isBreakout: boolean;
};

export type GtResponse = {
  timeSeries: GtTimeSeries | null;
  regions: GtRegion[];
  topics: GtRelated[];
  queries: GtRelated[];
  /** true si alguna llamada a Google falló (la UI lo declara). */
  partial: boolean;
};

/* ── Helpers de parseo (unknown → tipos seguros) ───────────────────────── */

type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord | null {
  return typeof value === "object" && value !== null ? (value as LooseRecord) : null;
}

function parseTimeSeries(widget: unknown): GtTimeSeries | null {
  const rec = asRecord(widget);
  if (!rec) return null;
  const timeline = rec.timelineData;
  if (!Array.isArray(timeline) || timeline.length === 0) return null;

  const points: GtPoint[] = [];
  for (const raw of timeline) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const valueArr = entry.value;
    const rawValue = Array.isArray(valueArr) ? valueArr[0] : undefined;
    const time = entry.time;
    if (typeof rawValue === "number" && typeof time === "number") {
      points.push({ time, value: rawValue });
    }
  }
  if (points.length === 0) return null;

  const values = points.map((p) => p.value);
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  return { points, average };
}

function parseRegions(widget: unknown): GtRegion[] {
  const rec = asRecord(widget);
  if (!rec) return [];
  const geoMap = rec.geoMapData;
  if (!Array.isArray(geoMap)) return [];
  const out: GtRegion[] = [];
  for (const raw of geoMap) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const geoCode = entry.geoCode;
    const value = entry.value;
    if (typeof geoCode === "string" && typeof value === "number") {
      out.push({ geoCode, value });
    }
  }
  return out;
}

function parseRelated(widget: unknown): GtRelated[] {
  const rec = asRecord(widget);
  if (!rec) return [];
  const ranked = rec.rankedList;
  if (!Array.isArray(ranked)) return [];
  const out: GtRelated[] = [];
  for (const rawGroup of ranked) {
    const group = asRecord(rawGroup);
    if (!group) continue;
    const list = group.rankedKeyword;
    if (!Array.isArray(list)) continue;
    for (const rawKw of list) {
      const kw = asRecord(rawKw);
      if (!kw) continue;
      // label puede venir como query o como topic.title
      let label: string | null = null;
      if (typeof kw.query === "string") {
        label = kw.query;
      } else {
        const topic = asRecord(kw.topic);
        if (topic && typeof topic.title === "string") label = topic.title;
      }
      if (!label) continue;

      // value para top es índice; formattedValue para rising es "+900%".
      let numValue = 0;
      let pct: number | null = null;
      const value = kw.value;
      if (typeof value === "number") {
        numValue = value;
      }
      const isBreakout = typeof kw.breakout === "number" && kw.breakout > 0;
      const formatted = kw.formattedValue;
      if (
        typeof formatted === "string" &&
        formatted.startsWith("+") &&
        formatted.endsWith("%")
      ) {
        const parsed = parseInt(formatted.slice(1, -1), 10);
        if (!Number.isNaN(parsed)) pct = parsed;
      }

      out.push({ label, value: numValue, pct: isBreakout ? null : pct, isBreakout });
    }
  }
  return out;
}

/* ── Endpoint público: explore → tokens → multiline/comparedgeo/related ── */

/**
 * Obtiene los tokens de widget para una consulta.
 * El endpoint `explore` devuelve los IDs de widget que luego se consultan
 * individualmente en `widgetdata/*`.
 */
async function explore(
  kw: string,
  geo: string,
  timeframe: string
): Promise<{ multilineToken: string | null; comparedGeoToken: string | null; relatedToken: string | null }> {
  const params = new URLSearchParams({
    hl: "es-MX",
    tz: "360", // UTC-6 (México)
  });
  const request = {
    comparisonItem: [{ keyword: kw, geo, time: timeframe }],
    category: 0,
    property: "",
  };
  params.set("req", JSON.stringify(request));

  const data = asRecord(await rateLimitedFetch(`/explore?${params.toString()}`));
  if (!data || !Array.isArray(data.widgets)) {
    return { multilineToken: null, comparedGeoToken: null, relatedToken: null };
  }

  let multilineToken: string | null = null;
  let comparedGeoToken: string | null = null;
  let relatedToken: string | null = null;
  for (const raw of data.widgets) {
    const widget = asRecord(raw);
    if (!widget) continue;
    const id = widget.id;
    const token = widget.token;
    if (typeof token !== "string") continue;
    if (id === "TIMESERIES") multilineToken = token;
    if (id === "GEO_MAP_0") comparedGeoToken = token;
    if (id === "RELATED_QUERIES") relatedToken = token;
    if (id === "RELATED_TOPICS") relatedToken = relatedToken ?? token;
  }
  return { multilineToken, comparedGeoToken, relatedToken };
}

/**
 * Consulta Google Trends para un término. Nunca lanza: cualquier fallo
 * devuelve la parte disponible con `partial=true`.
 */
export async function fetchGt(
  kw: string,
  geo = "MX",
  timeframe = "now 1-m"
): Promise<GtResponse> {
  const key = cacheKey([kw, geo, timeframe]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.data;
  }

  let partial = false;
  const { multilineToken, comparedGeoToken, relatedToken } = await explore(
    kw,
    geo,
    timeframe
  );

  // Time series (la gráfica principal)
  let timeSeries: GtTimeSeries | null = null;
  if (multilineToken) {
    const params = new URLSearchParams({
      hl: "es-MX",
      tz: "360",
      req: JSON.stringify({ geo, token: multilineToken }),
    });
    const data = asRecord(
      await rateLimitedFetch(`/widgetdata/multiline?${params.toString()}`)
    );
    timeSeries = data ? parseTimeSeries(data.default) : null;
    if (!timeSeries) partial = true;
  } else {
    partial = true;
  }

  // Regiones
  let regions: GtRegion[] = [];
  if (comparedGeoToken) {
    const params = new URLSearchParams({
      hl: "es-MX",
      tz: "360",
      req: JSON.stringify({ geo, token: comparedGeoToken }),
    });
    const data = asRecord(
      await rateLimitedFetch(`/widgetdata/comparedgeo?${params.toString()}`)
    );
    regions = data ? parseRegions(data.default) : [];
  }

  // Relacionados
  const topics: GtRelated[] = [];
  const queries: GtRelated[] = [];
  if (relatedToken) {
    const params = new URLSearchParams({
      hl: "es-MX",
      tz: "360",
      req: JSON.stringify({ geo, token: relatedToken }),
    });
    const data = asRecord(
      await rateLimitedFetch(`/widgetdata/relatedsearches?${params.toString()}`)
    );
    if (data) {
      const related = parseRelated(data.default);
      // El widget RELATED_QUERIES agrupa rankedKeyword con "query";
      // RELATED_TOPICS con "topic.title". Distinguimos por presencia.
      for (const r of related) {
        if (r.label) {
          queries.push(r);
        }
      }
    }
  }

  const result: GtResponse = {
    timeSeries,
    regions,
    topics,
    queries,
    partial,
  };
  if (timeSeries) {
    cache.set(key, { at: Date.now(), data: result });
  }
  return result;
}

/** Verifica que Google Trends responde (para el test de conexión en settings). */
export async function verifyGt(
  kw = "tecnología",
  geo = "MX"
): Promise<{ ok: boolean; reason?: string }> {
  const data = await fetchGt(kw, geo, "now 1-m");
  if (data.timeSeries && data.timeSeries.points.length > 0) {
    return { ok: true };
  }
  return { ok: false, reason: "Google Trends no devolvió serie temporal." };
}
