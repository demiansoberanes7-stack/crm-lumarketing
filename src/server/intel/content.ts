import { gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { normalizeText } from "@/server/intel/stats";
import { addDays, utcDay } from "@/server/intel/service";
import { mentionsPhrase } from "@/server/intel/terms";

/**
 * Contenidos orgánicos (Grupo D) — análisis de la muestra de videos
 * capturados por la ingesta de YouTube (mostPopular MX) que coinciden con
 * los nichos monitoreados. Sin terceros nuevos: usa la misma key de YouTube.
 *
 * Honestidad metodológica (nunca inventar):
 * - La muestra es SESGADA a popularidad: son videos que ya están en el feed
 *   popular de México, no el universo de videos del nicho. Sirve para
 *   "cómo se ve el contenido que ya funciona", no para proyectar resultados.
 * - Engagement = likes / vistas × 100 (los dislikes y comentarios no están
 *   en la capa gratuita).
 * - Un video puede coincidir con varios nichos: en el total global se
 *   deduplica por videoId; por nicho se cuenta en cada uno.
 */

export type DurationBucket = "short" | "medio" | "largo" | "sin_dato";

export function durationBucket(seconds: number | null): DurationBucket {
  if (seconds === null || seconds <= 0) return "sin_dato";
  if (seconds < 60) return "short";
  if (seconds <= 600) return "medio";
  return "largo";
}

export const DURATION_LABEL: Record<DurationBucket, string> = {
  short: "Short (<60 s)",
  medio: "Medio (1–10 min)",
  largo: "Largo (>10 min)",
  sin_dato: "Sin dato",
};

export type TitlePattern =
  | "listicle"
  | "pregunta"
  | "tutorial"
  | "comparativa"
  | "resena"
  | "otro";

/**
 * Clasifica el título por patrón (primera regla que aplica gana). El
 * matching léxico va sobre texto normalizado (sin acentos, minúsculas);
 * la detección de preguntas usa el crudo porque normalizeText borra «?».
 */
export function classifyTitlePattern(title: string): TitlePattern {
  const t = normalizeText(title);
  if (/\b(top|mejores)\s*\d+|\d+\s*(tips|trucos|formas|maneras|razones|cosas|pasos|ideas|motivos|errores|secretos|hacks)\b/.test(t)) {
    return "listicle";
  }
  if (title.includes("?") || title.includes("¿")) return "pregunta";
  if (/\b(como|tutorial|aprende|guia|paso a paso|desde cero|explicado)\b/.test(t)) {
    return "tutorial";
  }
  if (/\b(vs|versus|comparativa|comparacion)\b/.test(t)) return "comparativa";
  if (/\b(review|resena|analisis|opinion|unboxing|probando|test)\b/.test(t)) {
    return "resena";
  }
  return "otro";
}

export const PATTERN_LABEL: Record<TitlePattern, string> = {
  listicle: "Listas («top N», «N tips»)",
  pregunta: "Preguntas («¿…?»)",
  tutorial: "Tutoriales («cómo…»)",
  comparativa: "Comparativas («vs»)",
  resena: "Reseñas / unboxing",
  otro: "Otros",
};

export function engagementPct(views: number, likes: number): number | null {
  if (views <= 0) return null;
  return (likes / views) * 100;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export type ContentVideo = {
  videoId: string;
  title: string;
  views: number;
  likes: number;
  engagementPct: number | null;
  durationSeconds: number | null;
  bucket: DurationBucket;
  channelTitle: string | null;
};

export type BucketStat = {
  bucket: DurationBucket;
  label: string;
  count: number;
  medianViews: number;
  avgEngagementPct: number | null;
};

export type PatternStat = {
  pattern: TitlePattern;
  label: string;
  count: number;
  medianViews: number;
};

export type TermContentStat = {
  termId: string;
  name: string;
  videos: number;
  medianViews: number;
  avgEngagementPct: number | null;
};

export type ContentInsights = {
  windowDays: number;
  dayStart: string;
  dayEnd: string;
  totalRows: number;
  uniqueVideos: number;
  /**
   * Consulta que acotó la muestra, o null (muestra completa). El contenido del
   * feed popular NO se oculta bajo una búsqueda: se filtra por ella y se
   * declaran cuántos videos casaron, para que «0 videos» no se lea como
   * «no hay contenido» cuando en realidad la muestra popular no habla de eso.
   */
  query: string | null;
  matchedVideos: number;
  top: ContentVideo[];
  durationStats: BucketStat[];
  patternStats: PatternStat[];
  termStats: TermContentStat[];
  generatedAt: string;
};

export async function getContentInsights(
  organizationId: string,
  windowDays = 30,
  query?: string | null
): Promise<ContentInsights> {
  const db = getDb();
  const dayEnd = utcDay();
  const dayStart = addDays(dayEnd, -(windowDays - 1));
  const scope = (query ?? "").trim().slice(0, 200) || null;

  const rows = await db
    .select()
    .from(schema.intelVideo)
    .where(
      scoped(
        schema.intelVideo.organizationId,
        organizationId,
        gte(schema.intelVideo.day, dayStart)
      )
    );

  // Dedupe global: por videoId nos quedamos con la fila de mayor views.
  const byVideo = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const prev = byVideo.get(row.videoId);
    if (!prev || Number(row.views) > Number(prev.views)) byVideo.set(row.videoId, row);
  }
  const unique = [...byVideo.values()];

  const toContentVideo = (row: (typeof rows)[number]): ContentVideo => {
    const views = Number(row.views);
    const likes = Number(row.likes);
    return {
      videoId: row.videoId,
      title: row.title ?? "",
      views,
      likes,
      engagementPct: engagementPct(views, likes),
      durationSeconds: row.durationSeconds,
      bucket: durationBucket(row.durationSeconds),
      channelTitle: row.channelTitle,
    };
  };

  // Acotado a la consulta: los KPIs se calculan sobre los videos que hablan de
  // lo buscado. Sin consulta, la muestra completa (comportamiento de siempre).
  const matched = scope
    ? unique.filter((row) => mentionsPhrase(row.title ?? "", scope))
    : unique;

  const top = matched
    .map(toContentVideo)
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  const durationStats: BucketStat[] = (["short", "medio", "largo", "sin_dato"] as const)
    .map((bucket) => {
      const group = matched.filter((r) => durationBucket(r.durationSeconds) === bucket);
      const engagements = group
        .map((r) => engagementPct(Number(r.views), Number(r.likes)))
        .filter((v): v is number => v !== null);
      return {
        bucket,
        label: DURATION_LABEL[bucket],
        count: group.length,
        medianViews: median(group.map((r) => Number(r.views))),
        avgEngagementPct:
          engagements.length > 0
            ? engagements.reduce((a, b) => a + b, 0) / engagements.length
            : null,
      };
    })
    .filter((s) => s.count > 0);

  const patternStats: PatternStat[] = (
    ["listicle", "pregunta", "tutorial", "comparativa", "resena", "otro"] as const
  )
    .map((pattern) => {
      const group = matched.filter((r) => classifyTitlePattern(r.title ?? "") === pattern);
      return {
        pattern,
        label: PATTERN_LABEL[pattern],
        count: group.length,
        medianViews: median(group.map((r) => Number(r.views))),
      };
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.medianViews - a.medianViews);

  // Por nicho: el video se cuenta en cada término con el que coincidió. Con
  // consulta, solo los videos que hablan de esa consulta.
  const scopeRows = scope
    ? rows.filter((row) => mentionsPhrase(row.title ?? "", scope))
    : rows;
  const byTerm = new Map<string, { name: string; rows: typeof rows }>();
  for (const row of scopeRows) {
    const entry = byTerm.get(row.termId) ?? { name: "", rows: [] as typeof rows };
    entry.rows.push(row);
    byTerm.set(row.termId, entry);
  }
  const termRows = await db
    .select({ id: schema.intelTerm.id, name: schema.intelTerm.name })
    .from(schema.intelTerm)
    .where(scoped(schema.intelTerm.organizationId, organizationId));
  const names = new Map(termRows.map((t) => [t.id, t.name]));

  const termStats: TermContentStat[] = [...byTerm.entries()]
    .map(([termId, entry]) => {
      const seen = new Set<string>();
      const vids: ContentVideo[] = [];
      for (const row of entry.rows) {
        if (seen.has(row.videoId)) continue;
        seen.add(row.videoId);
        vids.push(toContentVideo(row));
      }
      const engagements = vids
        .map((v) => v.engagementPct)
        .filter((v): v is number => v !== null);
      return {
        termId,
        name: names.get(termId) ?? entry.name,
        videos: vids.length,
        medianViews: median(vids.map((v) => v.views)),
        avgEngagementPct:
          engagements.length > 0
            ? engagements.reduce((a, b) => a + b, 0) / engagements.length
            : null,
      };
    })
    .filter((s) => s.videos > 0)
    .sort((a, b) => b.medianViews - a.medianViews)
    .slice(0, 12);

  return {
    windowDays,
    dayStart,
    dayEnd,
    totalRows: rows.length,
    uniqueVideos: unique.length,
    query: scope,
    matchedVideos: matched.length,
    top,
    durationStats,
    patternStats,
    termStats,
    generatedAt: new Date().toISOString(),
  };
}
