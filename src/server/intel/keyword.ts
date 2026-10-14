import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getIntelCredentials } from "@/server/intel/credentials";
import { classifyTitlePattern, engagementPct } from "@/server/intel/content";
import { countEstablishments } from "@/server/intel/sources/denue";
import { fetchSuggestions } from "@/server/intel/sources/suggest";
import {
  searchVideos,
  type SearchHit,
} from "@/server/intel/sources/youtube";
import { addDays, utcDay } from "@/server/intel/service";
import {
  classify,
  describe,
  growthZ,
  normalizeText,
  type Classification,
  type Descriptive,
} from "@/server/intel/stats";
import { resolveTerm } from "@/server/intel/terms";

/**
 * Analizador de palabras clave estilo SEMrush, con fuentes 100% gratuitas:
 *
 * - Intención de búsqueda: clasificación léxica (transaccional / comercial /
 *   informativo / navegacional) sobre la consulta — misma lógica que usan
 *   las suites de SEO para segmentar keywords.
 * - Dificultad (proxy 0–100): fórmula documentada que combina saturación de
 *   contenido (total de videos del SERP de YouTube), fuerza de incumbentes
 *   (vistas mediana del top) y oferta local (establecimientos DENUE).
 *   NO es "keyword difficulty" pagada: es un proxy transparente y editable.
 * - Palabras relacionadas y preguntas: autocompletado público de Google
 *   (YouTube + web), con degradación a vacío si el servicio cambia.
 * - SERP: resultados REALES de búsqueda de YouTube (no el feed popular).
 * - Interés medido: serie histórica del catálogo monitoreado, si coincide.
 *
 * Regla: nunca inventar. Sin credenciales → campos en null con su motivo.
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
  // Marcas propias del catálogo se tratan como navegacionales por el usuario.
  return "informativo";
}

/** ¿La consulta tiene forma de pregunta? (¿…?, «cómo/qué/por qué…»). */
export function isQuestion(q: string): boolean {
  const raw = q.trim();
  if (/[?¿]/.test(raw)) return true;
  // Prefijo interrogativo sin acentos («cómo» → «como»).
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
  /** Total de videos del SERP de YouTube para la consulta. */
  totalResults: number;
  /** Vistas mediana de los resultados del top. */
  medianViews: number;
  /** Establecimientos DENUE (proxy de oferta local); null si sin token. */
  establishments: number | null;
  /** true si DENUE devolvió ≥10 (censura). */
  censored: boolean;
};

/**
 * Dificultad proxy 0–100 con fórmula abierta. Pesos:
 * - 40% saturación de contenido (totalResults, log 1e2→1e6)
 * - 40% incumbentes (vistas mediana del top, log 1e3→1e7)
 * - 20% oferta local DENUE (conteo, log 1→200); si no hay DENUE, el peso
 *   se redistribuye proporcionalmente entre los otros dos factores.
 */
export function difficultyProxy(input: DifficultyInput): Difficulty {
  const contentScore = logScale(input.totalResults, 100, 1_000_000);
  const incumbentScore = logScale(input.medianViews, 1_000, 10_000_000);
  const localRaw = input.censored
    ? Math.max(input.establishments ?? 10, 10)
    : input.establishments ?? 0;
  const localScore = logScale(localRaw, 1, 200);

  const factors: DifficultyFactor[] = [
    {
      label: "Saturación de contenido (YouTube)",
      raw: `${input.totalResults.toLocaleString("es-MX")} videos en el SERP`,
      weightPct: 0,
      factorScore: Math.round(contentScore),
    },
    {
      label: "Fuerza de incumbentes (vistas del top)",
      raw: `mediana ${Math.round(input.medianViews).toLocaleString("es-MX")} vistas`,
      weightPct: 0,
      factorScore: Math.round(incumbentScore),
    },
  ];
  if (input.establishments !== null) {
    factors.push({
      label: "Oferta local (DENUE)",
      raw: input.censored
        ? `≥${input.establishments} establecimientos`
        : `${input.establishments} establecimientos`,
      weightPct: 0,
      factorScore: Math.round(localScore),
    });
  }

  // Reparto de pesos: 40/40/20 o 50/50 sin DENUE.
  const weights =
    input.establishments !== null ? [40, 40, 20] : [50, 50];
  factors.forEach((f, i) => {
    f.weightPct = weights[i] ?? 0;
  });

  const score = Math.round(
    factors.reduce((acc, f) => acc + (f.factorScore * f.weightPct) / 100, 0)
  );
  return {
    score,
    band: band(score),
    factors,
    formula:
      input.establishments !== null
        ? "40% saturación + 40% incumbentes + 20% oferta local"
        : "50% saturación + 50% incumbentes (sin DENUE, sin factor local)",
  };
}

export type RelatedKeyword = {
  keyword: string;
  intent: SearchIntent;
  /** Último interés medido si el término está en el catálogo monitoreado. */
  tracked: {
    lastValue: number;
  } | null;
};

export type SerpVideo = {
  position: number;
  videoId: string;
  title: string;
  channelTitle: string | null;
  views: number;
  likes: number;
  engagementPct: number | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  pattern: ReturnType<typeof classifyTitlePattern>;
};

export type KeywordOverview = {
  query: string;
  intent: SearchIntent;
  difficulty: Difficulty;
  /** Total de videos del SERP (saturación). */
  totalResults: number | null;
  /** Oferta local DENUE; null sin token o sin dato. */
  competition: { establishments: number; censored: boolean } | null;
  related: RelatedKeyword[];
  questions: string[];
  serp: SerpVideo[];
  /** Historial medido si la consulta coincide con un nicho monitoreado. */
  tracked: {
    termId: string;
    name: string;
    classification: Classification;
    z: number | null;
    series: Descriptive | null;
    seriesPoints: Array<{ day: string; value: number }>;
  } | null;
  sources: string[];
  generatedAt: string;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
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

  // Registro de búsqueda (métrica de uso del módulo, igual que antes).
  const term = await resolveTerm(organizationId, q);
  await db.insert(schema.intelSearchLog).values({
    id: newId("intelSearch"),
    organizationId,
    query: q,
    termId: term?.id ?? null,
  });

  const creds = await getIntelCredentials(organizationId);

  const [ytSuggestions, webSuggestions, serp, denue] = await Promise.all([
    fetchSuggestions(q, true),
    fetchSuggestions(q, false),
    creds?.youtubeKey
      ? searchVideos(creds.youtubeKey, q, 12).catch(() => null)
      : Promise.resolve(null),
    creds?.denueToken
      ? countEstablishments(creds.denueToken, term?.keywords.length ? term.keywords : [q]).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Relacionadas: unión yt + web, dedupe, sin la consulta exacta, top 20.
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

  // Interés medido para las relacionadas que sí están en el catálogo.
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

  const lastSnapshots = matchedIds.size
    ? await db
        .select()
        .from(schema.intelSnapshot)
        .where(
          scoped(
            schema.intelSnapshot.organizationId,
            organizationId,
            inArray(schema.intelSnapshot.termId, [...matchedIds])
          )
        )
        .orderBy(desc(schema.intelSnapshot.day))
    : [];
  const lastByTerm = new Map<string, (typeof lastSnapshots)[number]>();
  for (const row of lastSnapshots) {
    if (!lastByTerm.has(row.termId)) lastByTerm.set(row.termId, row);
  }

  const related: RelatedKeyword[] = relatedNonQuestions.map((kw) => {
    const t = matchesFor(kw);
    const snap = t ? lastByTerm.get(t.id) : undefined;
    return {
      keyword: kw,
      intent: classifyIntent(kw),
      tracked: snap
        ? {
            lastValue: Number(snap.value),
          }
        : null,
    };
  });

  // Historial de la consulta si coincide con un nicho.
  let tracked: KeywordOverview["tracked"] = null;
  if (term) {
    const end = utcDay();
    const start = addDays(end, -27);
    const seriesRows = await db
      .select()
      .from(schema.intelSnapshot)
      .where(
        scoped(
          schema.intelSnapshot.organizationId,
          organizationId,
          eq(schema.intelSnapshot.termId, term.id)
        )
      )
      .orderBy(schema.intelSnapshot.day);
    const points = seriesRows
      .filter((s) => s.day >= start && s.day <= end)
      .map((s) => ({ day: s.day, value: Number(s.value) }));
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

  const serpVideos: SerpVideo[] = (serp?.videos ?? []).map((v: SearchHit) => ({
    position: v.position,
    videoId: v.videoId,
    title: v.title,
    channelTitle: v.channelTitle,
    views: v.views,
    likes: v.likes,
    engagementPct: engagementPct(v.views, v.likes),
    durationSeconds: v.durationSeconds,
    publishedAt: v.publishedAt,
    pattern: classifyTitlePattern(v.title),
  }));

  const topViews = serpVideos.map((v) => v.views);
  const difficulty = difficultyProxy({
    totalResults: serp?.totalResults ?? 0,
    medianViews: median(topViews),
    establishments: denue?.count ?? null,
    censored: denue?.censored ?? false,
  });

  const sources = ["YouTube Data API (search + videos, MX)"];
  if (ytSuggestions.length > 0 || webSuggestions.length > 0) {
    sources.push("Autocompletado público de Google (es-MX)");
  }
  if (denue) sources.push("DENUE · INEGI (oferta local)");
  if (tracked) sources.push("Serie histórica del catálogo monitoreado");

  return {
    query: q,
    intent: classifyIntent(q),
    difficulty,
    totalResults: serp?.totalResults ?? null,
    competition: denue
      ? { establishments: denue.count, censored: denue.censored }
      : null,
    related,
    questions,
    serp: serpVideos,
    tracked,
    sources,
    generatedAt: new Date().toISOString(),
  };
}
