import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getIntelCredentials } from "@/server/intel/credentials";
import { countEstablishments } from "@/server/intel/sources/denue";
import { fetchSuggestions } from "@/server/intel/sources/suggest";
import { getTrendsFromProviders } from "@/server/intel/trends-orchestrator";
import {
  addDays,
  getGtReport,
  googleGeoToInegi,
  utcDay,
  type GtReport,
} from "@/server/intel/service";
import {
  classify,
  describe,
  growthZ,
  normalizeText,
  toIndex,
  type Classification,
  type Descriptive,
} from "@/server/intel/stats";
import { resolveTerm } from "@/server/intel/terms";

/**
 * Analizador de palabras clave estilo SEMrush, con fuentes 100% EXTERNAS:
 *
 * - Intención de búsqueda: clasificación léxica sobre la consulta.
 * - Dificultad (proxy 0–100): fórmula abierta basada en oferta local DENUE
 *   (establecimientos coincidentes). Sin DENUE → sin score de dificultad.
 * - Palabras relacionadas y preguntas: autocompletado público de Google.
 * - Interés medido: SOLO serie Google Trends del nicho monitoreado (si coincide).
 *
 * Sin SERP de YouTube, sin vistas de canales, sin datos internos del CRM.
 * Regla: nunca inventar. Sin fuente → campos en null con su motivo.
 */

export type SearchIntent = "transaccional" | "comercial" | "informativo" | "navegacional";

export const INTENT_LABEL: Record<SearchIntent, string> = {
  transaccional: "Transaccional",
  comercial: "Comercial",
  informativo: "Informativo",
  navegacional: "Navegacional",
};

const TRANSACTIONAL =
  /\b(comprar|compras|compra|precio|precios|cuanto cuesta|costo|costos|cotizar|cotizacion|cupon|cupones|oferta|ofertas|descuento|descuentos|promocion|promociones|envio|envios|barato|barata|economico|rentar|alquilar|contratar|mayoreo|menudeo|stock|disponible|disponibilidad|pedido|pedidos)\b/;
const COMMERCIAL =
  /\b(mejor|mejores|top|vs|versus|review|reviews|resena|resenas|comparativa|comparacion|comparar|cual elegir|cual es mejor|cuál elegir|recomendacion|recomendaciones|recomendado|calidad|pro|contra| vale la pena)\b/;
const INFORMATIONAL =
  /\b(como|que es|que son|significado|tutorial|tutoriales|guia|guias|tips|trucos|ejemplos|ejemplo|porque|por que|cuando|cuanto tiempo|diferencia|paso a paso|aprender|instalar|configurar|configuracion|ideas|consejos|errores|causas|beneficios|ventajas|desventajas)\b/;

/** Clasifica la intención de la consulta (prioridad: transaccional > comercial > informativo). */
export function classifyIntent(query: string): SearchIntent {
  const q = normalizeText(query);
  if (TRANSACTIONAL.test(q)) return "transaccional";
  if (COMMERCIAL.test(q)) return "comercial";
  if (INFORMATIONAL.test(q)) return "informativo";
  return "navegacional";
}

function isQuestion(s: string): boolean {
  const raw = s.trim();
  if (/[?¿]/.test(raw)) return true;
  const plain = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /^(como|que|quien|donde|cuando|cuanto|por que|porque|cual|cuales)\b/.test(plain);
}

export type DifficultyBand = "baja" | "media" | "alta" | "muy alta";

export type DifficultyFactor = {
  label: string;
  /** Valor crudo del factor (texto para el tooltip). */
  raw: string;
  /** Contribución al score final (suma 100 con los factores presentes). */
  weightPct: number;
  /** 0–100: qué tan duro es este factor. */
  factorScore: number;
};

export type Difficulty = {
  score: number;
  band: DifficultyBand;
  factors: DifficultyFactor[];
  formula: string;
};

function band(score: number): DifficultyBand {
  if (score < 25) return "baja";
  if (score < 50) return "media";
  if (score < 75) return "alta";
  return "muy alta";
}

/** Escala logarítmica 0–100: `floor` → 0, `ceiling` → 100. */
function logScale(value: number, floor: number, ceiling: number): number {
  if (value <= floor) return 0;
  const v = Math.log10(value);
  const lo = Math.log10(floor);
  const hi = Math.log10(ceiling);
  return Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
}

export type DifficultyInput = {
  /** Establecimientos DENUE (proxy de oferta local); null si sin token. */
  establishments: number | null;
  /** true si DENUE devolvió ≥10 (censura). */
  censored: boolean;
};

/**
 * Dificultad proxy 0–100 con fórmula abierta. Fuente: SOLO oferta local DENUE
 * (establecimientos coincidentes, log 1→200). Sin DENUE → score 0 y factor ausente.
 */
export function difficultyProxy(input: DifficultyInput): Difficulty {
  if (input.establishments === null) {
    return {
      score: 0,
      band: "baja",
      factors: [],
      formula: "Sin DENUE — dificultad no disponible",
    };
  }
  const localRaw = input.censored
    ? Math.max(input.establishments, 10)
    : input.establishments;
  const localScore = logScale(localRaw, 1, 200);
  const factor: DifficultyFactor = {
    label: "Oferta local (DENUE)",
    raw: input.censored
      ? `≥${input.establishments} establecimientos`
      : `${input.establishments} establecimientos`,
    weightPct: 100,
    factorScore: Math.round(localScore),
  };
  return {
    score: factor.factorScore,
    band: band(factor.factorScore),
    factors: [factor],
    formula: "100% oferta local DENUE (proxy, no es KD de pago)",
  };
}

export type RelatedKeyword = {
  keyword: string;
  intent: SearchIntent;
  /** Último índice GT si el término está en el catálogo monitoreado. */
  tracked: {
    lastValue: number;
  } | null;
};

/** Relacionado de Google Trends (tema o consulta, principal o subiendo). */
export type MarketRelated = {
  label: string;
  value: number;
  pct: number | null;
  isBreakout: boolean;
  list: "top" | "rising";
};

/**
 * Datos de Google Trends para la consulta buscada. Se leen del catálogo si la
 * keyword ya está monitoreada; si no, se consultan EN VIVO al proveedor. Sin
 * respuesta no se rellena con ceros: `market` queda null y se explica por qué.
 */
export type KeywordMarket = {
  series: Array<{ day: string; value: number }>;
  regions: Array<{ state: string; index: number }>;
  topics: MarketRelated[];
  queries: MarketRelated[];
  provider: "serpapi" | "apify" | "web" | "catalog";
  sourceLabel: string;
  window: string;
  partial: boolean;
};

export type KeywordOverview = {
  query: string;
  intent: SearchIntent;
  difficulty: Difficulty;
  /** Oferta local DENUE; null sin token o sin dato. */
  competition: { establishments: number; censored: boolean } | null;
  related: RelatedKeyword[];
  questions: string[];
  /** Historial GT si la consulta coincide con un nicho monitoreado. */
  tracked: {
    termId: string;
    name: string;
    classification: Classification;
    z: number | null;
    series: Descriptive | null;
    seriesPoints: Array<{ day: string; value: number }>;
  } | null;
  market: KeywordMarket | null;
  /** Motivo legible cuando Google Trends no aportó datos. */
  marketNote: string | null;
  sources: string[];
  generatedAt: string;
};

const SEARCH_MARKET_TTL_MS = 10 * 60 * 1000;
const SEARCH_MARKET_TIMEOUT_MS = 12_000;

// Caché en memoria por proceso: buscar dos veces la misma keyword en la misma
// sesión no vuelve a gastar una consulta del proveedor.
const searchMarketCache = new Map<
  string,
  { at: number; market: KeywordMarket | null; note: string | null }
>();

function marketFromReport(report: GtReport): KeywordMarket {
  return {
    series: report.series,
    regions: report.regions.map((r) => ({ state: r.state, index: r.index })),
    topics: report.topics,
    queries: report.queries,
    provider: "catalog",
    sourceLabel:
      report.seriesSource === "google_trends"
        ? "Google Trends · serie del nicho monitoreado"
        : report.method.fuente,
    window: report.method.ventana,
    partial: false,
  };
}

async function fetchSearchMarket(
  organizationId: string,
  query: string
): Promise<{ market: KeywordMarket | null; note: string | null }> {
  const cacheKey = `${organizationId}:${normalizeText(query)}`;
  const cached = searchMarketCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_MARKET_TTL_MS) {
    return { market: cached.market, note: cached.note };
  }

  const orch = await Promise.race([
    getTrendsFromProviders(organizationId, [query], "MX", "today 1-m").catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), SEARCH_MARKET_TIMEOUT_MS)),
  ]);

  let market: KeywordMarket | null = null;
  let note: string | null = null;

  if (!orch) {
    note = "Google Trends no respondió a tiempo. El resto del análisis sí se completó.";
  } else if (!orch.data) {
    note = orch.error ?? "Google Trends no devolvió datos para esta búsqueda.";
  } else {
    const byDay = new Map<string, number>();
    for (const point of orch.data.timeSeries?.points ?? []) {
      const date = new Date(point.time);
      if (Number.isNaN(date.getTime())) continue;
      byDay.set(utcDay(date), point.value);
    }
    const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    const index = toIndex(days.map(([, value]) => value));
    const series = days.map(([day], i) => ({ day, value: index[i] ?? 0 }));

    const byState = new Map<string, number>();
    for (const region of orch.data.regions) {
      const state = googleGeoToInegi(region.geoCode);
      if (!state) continue;
      byState.set(state, Math.max(byState.get(state) ?? 0, region.value));
    }

    const hasData =
      series.length > 0 ||
      byState.size > 0 ||
      orch.data.topics.length > 0 ||
      orch.data.queries.length > 0;

    if (hasData) {
      market = {
        series,
        regions: [...byState.entries()].map(([state, value]) => ({ state, index: value })),
        topics: orch.data.topics.slice(0, 50),
        queries: orch.data.queries.slice(0, 50),
        provider: orch.provider === "none" ? "web" : orch.provider,
        sourceLabel: orch.sourceLabel,
        window: "últimos 30 días",
        partial: Boolean(orch.data.partial),
      };
      if (series.length === 0) {
        note = "Google Trends devolvió relacionados, pero no una serie de interés para esta búsqueda.";
      }
    } else {
      note = "Google Trends no devolvió serie, regiones ni relacionados para esta búsqueda.";
    }
  }

  if (searchMarketCache.size >= 100) {
    const oldest = searchMarketCache.keys().next().value;
    if (oldest !== undefined) searchMarketCache.delete(oldest);
  }
  searchMarketCache.set(cacheKey, { at: Date.now(), market, note });
  return { market, note };
}

/**
 * Analiza cualquier palabra clave (no requiere estar en el catálogo).
 * Fuentes en paralelo; cada una degrada a null sin bloquear las demás.
 */
export async function analyzeKeyword(
  organizationId: string,
  query: string
): Promise<KeywordOverview> {
  const db = getDb();
  const q = query.trim().slice(0, 200);

  const term = await resolveTerm(organizationId, q);
  await db.insert(schema.intelSearchLog).values({
    id: newId("intelSearch"),
    organizationId,
    query: q,
    termId: term?.id ?? null,
  });

  const creds = await getIntelCredentials(organizationId);

  const [ytSuggestions, webSuggestions, denue, storedReport] = await Promise.all([
    fetchSuggestions(q, true),
    fetchSuggestions(q, false),
    creds?.denueToken
      ? countEstablishments(creds.denueToken, term?.keywords.length ? term.keywords : [q]).catch(() => null)
      : Promise.resolve(null),
    term ? getGtReport(organizationId, term.id).catch(() => null) : Promise.resolve(null),
  ]);

  const seen = new Set([normalizeText(q)]);
  const relatedRaw: string[] = [];
  for (const s of [...ytSuggestions, ...webSuggestions]) {
    const key = normalizeText(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    relatedRaw.push(s);
    if (relatedRaw.length >= 20) break;
  }
  const questions = relatedRaw.filter((s) => isQuestion(s)).slice(0, 8);

  const relatedNonQuestions = relatedRaw.filter((s) => !questions.includes(s)).slice(0, 14);
  const catalogTerms = await db
    .select({ id: schema.intelTerm.id, name: schema.intelTerm.name, keywords: schema.intelTerm.keywords })
    .from(schema.intelTerm)
    .where(scoped(schema.intelTerm.organizationId, organizationId, eq(schema.intelTerm.active, true)));

  const matchesFor = (kw: string) => {
    const n = normalizeText(kw);
    return catalogTerms.find((t) => {
      const nameHit = normalizeText(t.name).includes(n) || n.includes(normalizeText(t.name));
      const kwHit = Array.isArray(t.keywords) && t.keywords.some(
        (k) => typeof k === "string" && (normalizeText(k).includes(n) || n.includes(normalizeText(k)))
      );
      return nameHit || kwHit;
    });
  };

  const matchedIds = new Set<string>();
  for (const kw of relatedNonQuestions) {
    const t = matchesFor(kw);
    if (t) matchedIds.add(t.id);
  }
  if (term) matchedIds.add(term.id);

  // Último índice GT por término monitoreado (fuente 100 % externa).
  const lastGt = matchedIds.size
    ? await db
        .select()
        .from(schema.intelGtSnapshot)
        .where(
          scoped(
            schema.intelGtSnapshot.organizationId,
            organizationId,
            inArray(schema.intelGtSnapshot.termId, [...matchedIds])
          )
        )
        .orderBy(desc(schema.intelGtSnapshot.day))
    : [];
  const lastGtByTerm = new Map<string, number>();
  for (const row of lastGt) {
    if (!lastGtByTerm.has(row.termId)) lastGtByTerm.set(row.termId, row.value);
  }

  const related: RelatedKeyword[] = relatedNonQuestions.map((kw) => {
    const t = matchesFor(kw);
    const gt = t ? lastGtByTerm.get(t.id) : undefined;
    return {
      keyword: kw,
      intent: classifyIntent(kw),
      tracked: gt !== undefined ? { lastValue: gt } : null,
    };
  });

  // Historial GT de la consulta si coincide con un nicho.
  let tracked: KeywordOverview["tracked"] = null;
  if (term) {
    const end = utcDay();
    const start = addDays(end, -29);
    const seriesRows = await db
      .select()
      .from(schema.intelGtSnapshot)
      .where(
        scoped(
          schema.intelGtSnapshot.organizationId,
          organizationId,
          eq(schema.intelGtSnapshot.termId, term.id)
        )
      )
      .orderBy(schema.intelGtSnapshot.day);
    const points = seriesRows
      .filter((s) => s.day >= start && s.day <= end)
      .map((s) => ({ day: s.day, value: s.value }));
    const values = points.map((p) => p.value);
    const recent = values.slice(-7);
    const prior = values.slice(0, -7);
    const z = values.length >= 7 ? growthZ(recent, prior) : null;
    const verdict = classify({ daysWithData: values.length, z });
    tracked = {
      termId: term.id,
      name: term.name,
      classification: verdict.classification,
      z,
      series: values.length > 0 ? describe(values) : null,
      seriesPoints: points,
    };
  }

  let market: KeywordMarket | null = null;
  let marketNote: string | null = null;
  const hasStoredMarket = Boolean(
    storedReport &&
      (storedReport.series.length > 0 ||
        storedReport.regions.length > 0 ||
        storedReport.topics.length > 0 ||
        storedReport.queries.length > 0)
  );
  if (storedReport && hasStoredMarket) {
    market = marketFromReport(storedReport);
  } else {
    const live = await fetchSearchMarket(organizationId, q);
    market = live.market;
    marketNote = live.note;
  }

  const difficulty = difficultyProxy({
    establishments: denue?.count ?? null,
    censored: denue?.censored ?? false,
  });

  const sources: string[] = [];
  if (ytSuggestions.length > 0 || webSuggestions.length > 0) {
    sources.push("Autocompletado público de Google (es-MX)");
  }
  if (denue) sources.push("DENUE · INEGI (oferta local)");
  if (tracked) sources.push("Google Trends (serie del nicho monitoreado)");
  if (market && market.provider !== "catalog") sources.push(market.sourceLabel);
  if (sources.length === 0) sources.push("Sin fuentes externas disponibles");

  return {
    query: q,
    intent: classifyIntent(q),
    difficulty,
    competition: denue
      ? { establishments: denue.count, censored: denue.censored }
      : null,
    related,
    questions,
    tracked,
    market,
    marketNote,
    sources,
    generatedAt: new Date().toISOString(),
  };
}
