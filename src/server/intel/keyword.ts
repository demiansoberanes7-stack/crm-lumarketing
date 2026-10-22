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
  googleGeoToInegi,
  utcDay,
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
import { matchTerm, rankTerms, resolveTerm } from "@/server/intel/terms";

/**
 * Analizador de palabras clave estilo SEMrush, con fuentes 100% EXTERNAS:
 *
 * - Intención de búsqueda: clasificación léxica sobre la consulta.
 * - Dificultad (proxy 0–100): fórmula abierta basada en oferta local DENUE
 *   (establecimientos coincidentes). Sin DENUE → sin score de dificultad.
 * - Palabras relacionadas y preguntas: autocompletado público de Google.
 * - Interés medido: serie Google Trends EN VIVO de la consulta. El nicho
 *   monitoreado que se le parezca aparece aparte, anidado y etiquetado.
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
  /** Nicho del catálogo que cubre la relacionada (similitud ≥ umbral); null si es nueva. */
  niche: { name: string; score: number } | null;
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
 * Datos de Google Trends para la consulta buscada, SIEMPRE en vivo. El catálogo
 * solo aporta el bloque anidado `tracked`; sustituir la serie del nicho por la
 * de la búsqueda mostraba datos de otro tema (queja real: "redes sociales"
 * enseñaba la serie de "Redes y conectividad"). Sin respuesta no se rellena con
 * ceros: `market` queda null y `marketNote` explica por qué.
 */
export type KeywordMarket = {
  series: Array<{ day: string; value: number }>;
  regions: Array<{ state: string; index: number }>;
  topics: MarketRelated[];
  queries: MarketRelated[];
  provider: "serpapi" | "apify" | "web";
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
  /**
   * Bloque ANIDADO con el nicho monitoreado al que se parece la consulta.
   * Nunca pinta el gráfico principal: se etiqueta aparte, con su similitud.
   */
  tracked: {
    termId: string;
    name: string;
    classification: Classification;
    z: number | null;
    series: Descriptive | null;
    seriesPoints: Array<{ day: string; value: number }>;
    /** 0-1: qué tan parecida es la consulta al nicho. */
    matchScore: number;
    /** Nombre o keyword del catálogo con la que coincidió. */
    matchedVia: string;
  } | null;
  /** Google Trends EN VIVO de la consulta buscada. */
  market: KeywordMarket | null;
  /** Motivo legible cuando Google Trends no aportó datos. */
  marketNote: string | null;
  /**
   * Todos los nichos del catálogo ordenados por parecido a la consulta,
   * incluidos los de score 0 (`via` vacío). Es lo que hace que el ranking, la
   * comparativa y el mapa de nichos se lean como contexto de ESTA búsqueda en
   * vez de desaparecer o de mostrarse sin relación declarada.
   */
  catalogMatches: Array<{
    termId: string;
    name: string;
    score: number;
    via: string;
    exact: boolean;
  }>;
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

  const resolved = await resolveTerm(organizationId, q);
  const term = resolved?.term ?? null;
  const match = resolved?.match ?? null;
  await db.insert(schema.intelSearchLog).values({
    id: newId("intelSearch"),
    organizationId,
    query: q,
    termId: term?.id ?? null,
  });

  const creds = await getIntelCredentials(organizationId);

  // La dificultad y el interés se miden SOBRE LA CONSULTA. El nicho del catálogo
  // solo alimenta el bloque anidado, nunca los KPIs principales.
  const [ytSuggestions, webSuggestions, denue] = await Promise.all([
    fetchSuggestions(q, true),
    fetchSuggestions(q, false),
    creds?.denueToken
      ? countEstablishments(creds.denueToken, [q]).catch(() => null)
      : Promise.resolve(null),
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

  const catalogForMatch = catalogTerms.map((t) => ({
    id: t.id,
    name: t.name,
    keywords: Array.isArray(t.keywords)
      ? t.keywords.filter((k): k is string => typeof k === "string")
      : [],
  }));

  /** Relacionada → nicho monitoreado, con la MISMA regla estricta que la consulta. */
  const matchesFor = (kw: string) => matchTerm(catalogForMatch, kw);

  /**
   * Nichos ordenados por parecido a la consulta, con los que no comparten
   * ninguna palabra incluidos (score 0, `via` vacío). Se calcula sobre el
   * catálogo ya leído: coste cero de red. Va completo, sin el tope de 6 de
   * `rankTerms`, porque cada panel de la pantalla tiene que poder etiquetar
   * TODOS sus nichos frente a la búsqueda.
   */
  const catalogMatches = rankTerms(catalogForMatch, q, catalogForMatch.length).map((t) => ({
    termId: t.id,
    name: t.name,
    score: t.score,
    via: t.via,
    exact: t.exact,
  }));

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
      /** Nicho que cubre esta relacionada, para poder etiquitarla en la UI. */
      niche: t ? { name: t.name, score: t.score } : null,
      tracked: gt !== undefined ? { lastValue: gt } : null,
    };
  });

  // Historial del nicho monitoreado, SIEMPRE como bloque anidado y etiquetado.
  let tracked: KeywordOverview["tracked"] = null;
  if (term && match) {
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
      matchScore: Math.round(match.score * 100) / 100,
      matchedVia: match.via,
    };
  }

  // Google Trends en vivo de la consulta buscada: nunca se sustituye por la
  // serie cacheada del nicho.
  const live = await fetchSearchMarket(organizationId, q);
  const market = live.market;
  const marketNote = live.note;

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
  if (market) sources.push(market.sourceLabel);
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
    catalogMatches,
    sources,
    generatedAt: new Date().toISOString(),
  };
}
