import { decryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * Google Trends vía Apify (proveedor de respaldo).
 *
 * Apify ejecuta un Actor (scraper) de Google Trends y devuelve los resultados
 * en un dataset. Este adaptador es genérico: funciona con cualquier Actor ID
 * que el owner configure desde el panel, ejecutándolo vía API y normalizando
 * su salida al mismo formato que SerpApi.
 *
 * Flujo:
 *   1. POST /v2/acts/{actorId}/runs → inicia ejecución
 *   2. Espera a que termine (poll)
 *   3. GET /v2/acts/{actorId}/runs/{runId}/dataset/items → lee resultados
 *   4. Normaliza al formato TrendsResponse
 *
 * La API token se guarda cifrada (AES-256-GCM). El Actor ID es configurable
 * desde el panel (no es secreto).
 */

const APIFY_API = "https://api.apify.com/v2";
const POLL_INTERVAL_MS = 2_000;
const MAX_WAIT_MS = 60_000;

/* ── Tipos ──────────────────────────────────────────────────────────────── */

export type ApifyTrendsResult = {
  timeSeries: { points: Array<{ time: number; value: number }>; average: number } | null;
  regions: Array<{ geoCode: string; value: number }>;
  // El Actor devuelve los relacionados en una lista plana: no distingue
  // «Principal» de «Subiendo», así que todo se marca `top` (sin % que heredar).
  topics: Array<{ label: string; value: number; pct: number | null; isBreakout: boolean; list: "top" | "rising" }>;
  queries: Array<{ label: string; value: number; pct: number | null; isBreakout: boolean; list: "top" | "rising" }>;
  partial: boolean;
  provider: "apify";
};

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec | null {
  return typeof v === "object" && v !== null ? (v as Rec) : null;
}

/* ── Helpers de red ─────────────────────────────────────────────────────── */

async function apifyFetch(
  token: string,
  path: string,
  init?: RequestInit
): Promise<Rec | null> {
  const url = new URL(`${APIFY_API}${path}`);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  return asRec(await res.json().catch(() => null));
}

/* ── Ejecución del Actor ────────────────────────────────────────────────── */

/**
 * Ejecuta el Actor de Google Trends en Apify y devuelve los items del dataset.
 * El input se construye de forma genérica para la mayoría de actores de GT.
 */
export async function runApifyActor(
  token: string,
  actorId: string,
  keywords: string[],
  geo = "MX"
): Promise<unknown[] | null> {
  // Normalizar actorId: Apify acepta "user~name". El usuario puede escribir
  // "user/name" o "user~name"; convertimos "/" → "~".
  const actorPath = actorId.replace(/\//g, "~").replace(/[^a-zA-Z0-9_~-]/g, "");

  const input = {
    searchTerms: keywords.slice(0, 5),
    countryCode: geo,
    timeframe: "today 1-m",
    // Algunos actores esperan este formato alternativo
    keywords: keywords.slice(0, 5),
    geo,
    date: "today 1-m",
  };

  // 1. Iniciar run
  const startData = await apifyFetch(token, `/acts/${actorPath}/runs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!startData) return null;

  const data = asRec(startData.data);
  const runId = data?.id;
  if (typeof runId !== "string") return null;

  // 2. Esperar a que termine
  const deadline = Date.now() + MAX_WAIT_MS;
  let succeeded = false;
  while (Date.now() < deadline) {
    const statusData = await apifyFetch(token, `/acts/${actorPath}/runs/${runId}`);
    if (!statusData) return null;
    const statusRec = asRec(statusData.data);
    const status = statusRec?.status;
    if (status === "SUCCEEDED") {
      succeeded = true;
      break;
    }
    if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
      return null;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // No leer el dataset después de agotar el límite: puede contener una
  // ejecución incompleta y convertir un timeout en un resultado aparentemente
  // válido.
  if (!succeeded) return null;

  // 3. Leer dataset
  const datasetData = await apifyFetch(
    token,
    `/acts/${actorPath}/runs/${runId}/dataset/items`
  );
  if (!datasetData) return null;

  // El endpoint de items devuelve un array directo; puede venir como array
  // dentro de `data` o como array plano.
  if (Array.isArray(datasetData)) return datasetData;
  const items = asRec(datasetData)?.data;
  if (Array.isArray(items)) return items;
  return null;
}

/* ── Normalización de respuesta ─────────────────────────────────────────── */

/**
 * Normaliza los items del dataset de Apify al formato TrendsResponse.
 * Los actores de GT devuelven varios formatos; aquí se cubren los más comunes:
 *   - items con `timeline` / `interest_by_region` / `related_topics` / `related_queries`
 *   - items planos con `date`+`value` (solo serie temporal)
 */
export function normalizeApifyItems(items: unknown[]): ApifyTrendsResult {
  if (items.length === 0) {
    return { timeSeries: null, regions: [], topics: [], queries: [], partial: true, provider: "apify" };
  }

  // Caso A: un solo item con estructura completa
  const first = asRec(items[0]);
  if (first?.timeline || first?.interest_by_region || first?.interestByRegion) {
    return normalizeFullItem(first);
  }

  // Caso B: items planos con date + value (serie temporal)
  const points: Array<{ time: number; value: number }> = [];
  for (const raw of items) {
    const e = asRec(raw);
    if (!e) continue;
    const dateStr = e.date ?? e.time ?? e.timestamp;
    const value = e.value ?? e.score ?? e.interest;
    if (value == null) continue;
    const time = typeof dateStr === "string" ? Date.parse(dateStr) : typeof dateStr === "number" ? dateStr : null;
    const numValue = typeof value === "number" ? value : typeof value === "string" ? parseInt(value, 10) : null;
    if (time !== null && numValue !== null && !Number.isNaN(time) && !Number.isNaN(numValue)) {
      points.push({ time, value: numValue });
    }
  }
  if (points.length === 0) {
    return { timeSeries: null, regions: [], topics: [], queries: [], partial: true, provider: "apify" };
  }
  const values = points.map((p) => p.value);
  return {
    timeSeries: { points, average: values.reduce((a, b) => a + b, 0) / values.length },
    regions: [],
    topics: [],
    queries: [],
    partial: true,
    provider: "apify",
  };
}

function normalizeFullItem(rec: Rec): ApifyTrendsResult {
  let partial = false;

  // Serie temporal
  let timeSeries: ApifyTrendsResult["timeSeries"] = null;
  const timeline = rec.timeline ?? rec.timeline_data;
  if (Array.isArray(timeline)) {
    const points: Array<{ time: number; value: number }> = [];
    for (const raw of timeline) {
      const e = asRec(raw);
      if (!e) continue;
      const vals = Array.isArray(e.values) ? e.values : Array.isArray(e.value) ? e.value : [e.value];
      const v = vals[0];
      const t = e.timestamp ?? e.time ?? e.date;
      const numV = typeof v === "number" ? v : null;
      const numT = typeof t === "number" ? t : typeof t === "string" ? Date.parse(t) : null;
      if (numV !== null && numT !== null && !Number.isNaN(numT)) {
        points.push({ time: numT, value: numV });
      }
    }
    if (points.length > 0) {
      const values = points.map((p) => p.value);
      timeSeries = { points, average: values.reduce((a, b) => a + b, 0) / values.length };
    } else {
      partial = true;
    }
  } else {
    partial = true;
  }

  // Regiones
  const regions: ApifyTrendsResult["regions"] = [];
  const byRegion = rec.interest_by_region ?? rec.interestByRegion ?? rec.geo_map_data;
  const regionList = Array.isArray(byRegion) ? byRegion : asRec(byRegion)?.geo_map_data;
  if (Array.isArray(regionList)) {
    for (const raw of regionList) {
      const e = asRec(raw);
      if (!e) continue;
      const code = e.geo_code ?? e.geoCode ?? e.location;
      const value = e.value ?? e.interest;
      if (typeof code === "string" && typeof value === "number") {
        regions.push({ geoCode: code, value });
      }
    }
  }

  // Temas y consultas
  const topics: ApifyTrendsResult["topics"] = [];
  const queries: ApifyTrendsResult["queries"] = [];
  const relTopics = rec.related_topics ?? rec.relatedTopics;
  if (Array.isArray(relTopics)) {
    for (const raw of relTopics) {
      const e = asRec(raw);
      if (!e) continue;
      const label = e.title ?? e.topic ?? e.label;
      if (typeof label === "string") {
        const value = typeof e.value === "number" ? e.value : 0;
        topics.push({ label, value, pct: null, isBreakout: false, list: "top" });
      }
    }
  }
  const relQueries = rec.related_queries ?? rec.relatedQueries;
  if (Array.isArray(relQueries)) {
    for (const raw of relQueries) {
      const e = asRec(raw);
      if (!e) continue;
      const label = e.query ?? e.label;
      if (typeof label === "string") {
        const value = typeof e.value === "number" ? e.value : 0;
        queries.push({ label, value, pct: null, isBreakout: false, list: "top" });
      }
    }
  }

  return { timeSeries, regions, topics, queries, partial, provider: "apify" };
}

/* ── Verificación de conexión ───────────────────────────────────────────── */

export async function verifyApify(
  token: string,
  actorId: string
): Promise<{ ok: boolean; reason?: string }> {
  const actorPath = actorId.replace(/\//g, "~").replace(/[^a-zA-Z0-9_~-]/g, "");
  const data = await apifyFetch(token, `/acts/${actorPath}`);
  if (!data) {
    return { ok: false, reason: "Apify no respondió. Verifica el token y el Actor ID." };
  }
  const actorRec = asRec(data.data);
  if (!actorRec) {
    return { ok: false, reason: "Actor no encontrado. Verifica el Actor ID." };
  }
  return { ok: true };
}

/* ── Lectura de credencial desde BD ─────────────────────────────────────── */

export async function getApifyCredentials(
  organizationId: string
): Promise<{ token: string; actorId: string } | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.intelCredentials)
    .where(scoped(schema.intelCredentials.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row?.apifyTokenCipher || !row.apifyTokenIv || !row.apifyTokenTag) {
    return null;
  }
  if (!row.apifyActorId) return null;
  try {
    const token = decryptSecret({
      cipher: row.apifyTokenCipher,
      iv: row.apifyTokenIv,
      tag: row.apifyTokenTag,
    });
    return { token, actorId: row.apifyActorId };
  } catch {
    return null;
  }
}
