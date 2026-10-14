import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  getIntelCredentials,
  markIntelIngested,
} from "@/server/intel/credentials";
import { ensureSeedTerms, listActiveTerms, resolveTerm } from "@/server/intel/terms";
import { matchTerms, youtubeSource } from "@/server/intel/sources/youtube";
import { countEstablishments } from "@/server/intel/sources/denue";
import {
  classify,
  describe,
  growthZ,
  oneSidedP,
  toIndex,
  type Classification,
  type Descriptive,
} from "@/server/intel/stats";

/** Día UTC "YYYY-MM-DD" — llave determinista de snapshots y videos. */
export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Suma `days` días naturales al día dado (parseando "YYYY-MM-DD" en UTC). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export class IngestNotConfiguredError extends Error {
  constructor() {
    super("Faltan credenciales de inteligencia");
    this.name = "IngestNotConfiguredError";
  }
}

export type IngestResult = {
  day: string;
  videosAnalyzed: number;
  termsMatched: number;
  snapshotsUpserted: number;
};

/**
 * Ingesta diaria: feed popular de YouTube (MX) contra el catálogo de
 * términos; guarda el agregado en `intel_snapshot` y la muestra cruda en
 * `intel_video` (ambos con dedupe por día, re-ejecutable).
 */
export async function runIngest(organizationId: string): Promise<IngestResult> {
  const creds = await getIntelCredentials(organizationId);
  if (!creds) throw new IngestNotConfiguredError();
  await ensureSeedTerms(organizationId);
  const terms = await listActiveTerms(organizationId);
  const videos = await youtubeSource.listMostPopular(creds.youtubeKey, "MX", 50);
  const day = utcDay();
  const byTerm = matchTerms(
    videos,
    terms.map((t) => ({ id: t.id, keywords: t.keywords }))
  );

  const db = getDb();
  let snapshotsUpserted = 0;
  let termsMatched = 0;

  for (const term of terms) {
    const matches = byTerm.get(term.id) ?? [];
    const totalViews = matches.reduce((acc, v) => acc + v.views, 0);
    if (matches.length > 0) termsMatched += 1;

    await db
      .insert(schema.intelSnapshot)
      .values({
        id: newId("intelSnapshot"),
        organizationId,
        termId: term.id,
        day,
        value: totalViews,
        videoCount: matches.length,
        source: "youtube_mostpopular",
      })
      .onConflictDoUpdate({
        target: [schema.intelSnapshot.termId, schema.intelSnapshot.day],
        set: { value: totalViews, videoCount: matches.length },
      });
    snapshotsUpserted += 1;

    if (matches.length > 0) {
      await db
        .insert(schema.intelVideo)
        .values(
          matches.map((v) => ({
            id: newId("intelVideo"),
            organizationId,
            termId: term.id,
            videoId: v.videoId,
            title: v.title.slice(0, 300),
            views: v.views,
            likes: v.likes,
            durationSeconds: v.durationSeconds,
            publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
            channelTitle: v.channelTitle?.slice(0, 200) ?? null,
            day,
          }))
        )
        .onConflictDoNothing();
    }
  }

  await markIntelIngested(organizationId);
  return { day, videosAnalyzed: videos.length, termsMatched, snapshotsUpserted };
}

export type TrendCard = {
  termId: string;
  name: string;
  /** z-score de los últimos 7 días contra los 21 previos (null si no aplica). */
  z: number | null;
  lastValue: number;
  lastVideoCount: number;
  /** Serie de los últimos 28 días (0 donde no hubo snapshot). */
  series: Array<{ day: string; value: number }>;
};

/**
 * Estado 1: tendencias actuales. Por término, z-score de la ventana reciente
 * contra el histórico; se ordena de mayor a menor z (los null al final).
 */
export async function getTrends(
  organizationId: string
): Promise<{ trends: TrendCard[]; lastIngestAt: string | null }> {
  const creds = await getIntelCredentials(organizationId);
  const terms = await listActiveTerms(organizationId);
  const end = utcDay();
  const start = addDays(end, -27);

  const db = getDb();
  const rows = terms.length
    ? await db
        .select()
        .from(schema.intelSnapshot)
        .where(
          scoped(
            schema.intelSnapshot.organizationId,
            organizationId,
            inArray(schema.intelSnapshot.termId, terms.map((t) => t.id))
          )
        )
        .orderBy(schema.intelSnapshot.day)
    : [];

  const byTerm = new Map<string, Array<{ day: string; value: number; videoCount: number }>>();
  for (const row of rows) {
    const list = byTerm.get(row.termId) ?? [];
    list.push({ day: row.day, value: Number(row.value), videoCount: row.videoCount });
    byTerm.set(row.termId, list);
  }

  const trends: TrendCard[] = [];
  for (const term of terms) {
    const history = (byTerm.get(term.id) ?? []).filter(
      (s) => s.day >= start && s.day <= end
    );
    if (history.length === 0) continue;
    const recent = history.slice(-7).map((s) => s.value);
    const prior = history.slice(0, -7).map((s) => s.value);
    const last = history[history.length - 1]!;
    trends.push({
      termId: term.id,
      name: term.name,
      z: growthZ(recent, prior),
      lastValue: last.value,
      lastVideoCount: last.videoCount,
      series: history.map((s) => ({ day: s.day, value: s.value })),
    });
  }
  trends.sort((a, b) => (b.z ?? -Infinity) - (a.z ?? -Infinity));
  return {
    trends,
    lastIngestAt: creds?.lastIngestAt?.toISOString() ?? null,
  };
}

export type SampleVideo = {
  videoId: string;
  title: string;
  views: number;
  likes: number;
};

export type SearchReport = {
  query: string;
  term: { id: string; name: string } | null;
  classification: Classification;
  headline: string;
  warnings: string[];
  series: Descriptive | null;
  seriesPoints: Array<{ day: string; value: number }>;
  videos: (Descriptive & { sample: SampleVideo[] }) | null;
  inferencia: { z: number | null; p: number | null; window: string };
  competencia: {
    establecimientos: number;
    censored: boolean;
    fuente: "DENUE · INEGI";
    nota: string;
  } | null;
  method: { fuente: string; geo: string; ventana: string };
  generatedAt: string;
};

const RECENT_WINDOW = "últimos 7 días vs 21 días previos";
const SERIES_WINDOW = "28 días (diario, UTC)";

/**
 * Estado 2: informe de búsqueda. Resuelve el término, calcula descriptiva e
 * inferencia sobre su serie, muestrea los videos coincidentes del último
 * ingest y, si hay token DENUE, agrega el conteo de establecimientos como
 * proxy de competencia. Nunca inventa datos: sin historia → clasificación D
 * con su advertencia; sin token DENUE → competencia null.
 */
export async function searchReport(
  organizationId: string,
  query: string
): Promise<SearchReport> {
  const db = getDb();
  const term = await resolveTerm(organizationId, query);
  await db
    .insert(schema.intelSearchLog)
    .values({
      id: newId("intelSearch"),
      organizationId,
      query: query.slice(0, 200),
      termId: term?.id ?? null,
    });

  const end = utcDay();
  const start = addDays(end, -27);
  const history = term
    ? (
        await db
          .select()
          .from(schema.intelSnapshot)
          .where(
            scoped(
              schema.intelSnapshot.organizationId,
              organizationId,
              eq(schema.intelSnapshot.termId, term.id)
          )
        )
          .orderBy(schema.intelSnapshot.day)
      ).filter((s) => s.day >= start && s.day <= end)
    : [];

  const seriesValues = history.map((s) => Number(s.value));
  const seriesPoints = history.map((s) => ({ day: s.day, value: Number(s.value) }));
  const recent = seriesValues.slice(-7);
  const prior = seriesValues.slice(0, -7);
  const z = seriesValues.length >= 7 ? growthZ(recent, prior) : null;
  const verdict = classify({ daysWithData: seriesValues.length, z });

  const day = history.length > 0 ? history[history.length - 1]!.day : utcDay();
  const videoRows =
    term && seriesValues.length > 0
      ? await db
          .select()
          .from(schema.intelVideo)
          .where(
            scoped(
              schema.intelVideo.organizationId,
              organizationId,
              eq(schema.intelVideo.termId, term.id),
              eq(schema.intelVideo.day, day)
          )
          )
          .orderBy(desc(schema.intelVideo.views))
          .limit(10)
      : [];
  const sample: SampleVideo[] = videoRows.map((v) => ({
    videoId: v.videoId,
    title: v.title ?? "",
    views: Number(v.views),
    likes: Number(v.likes),
  }));

  let competencia: SearchReport["competencia"] = null;
  const creds = await getIntelCredentials(organizationId);
  if (creds?.denueToken && term) {
    const count = await countEstablishments(creds.denueToken, term.keywords);
    if (count) {
      competencia = {
        establecimientos: count.count,
        censored: count.censored,
        fuente: "DENUE · INEGI",
        nota: count.censored
          ? "La ventana de la API devolvió 10 registros: el total real es ≥10."
          : "Conteo exacto de coincidencias en el directorio nacional.",
      };
    }
  }

  return {
    query,
    term: term ? { id: term.id, name: term.name } : null,
    classification: verdict.classification,
    headline: verdict.headline,
    warnings: verdict.warnings,
    series: seriesValues.length > 0 ? describe(seriesValues) : null,
    seriesPoints,
    videos:
      sample.length > 0
        ? { ...describe(sample.map((v) => v.views)), sample }
        : null,
    inferencia: {
      z,
      p: z !== null ? oneSidedP(z) : null,
      window: RECENT_WINDOW,
    },
    competencia,
    method: {
      fuente: "YouTube Data API · mostPopular (MX)",
      geo: term?.geo ?? "MX",
      ventana: SERIES_WINDOW,
    },
    generatedAt: new Date().toISOString(),
  };
}

export type TermCompareItem = {
  termId: string;
  name: string;
  seriesPoints: Array<{ day: string; value: number }>;
  descriptive: Descriptive;
  z: number | null;
  /** % del interés del último feed que representa este nicho (share). */
  sharePct: number;
  lastValue: number;
  videoCount: number;
  classification: Classification;
};

/**
 * Comparativa de 2–3 nichos: mismas métricas, misma ventana, unidades
 * explícitas. El share se calcula sobre la suma de vistas del último feed
 * entre los nichos monitoreados (no es share de mercado total).
 */
export async function compareTerms(
  organizationId: string,
  termIds: string[]
): Promise<{ terms: TermCompareItem[]; generatedAt: string }> {
  const requested = [...new Set(termIds)].slice(0, 3);
  const allTerms = await listActiveTerms(organizationId);
  const terms = requested
    .map((id) => allTerms.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const end = utcDay();
  const start = addDays(end, -27);
  const db = getDb();
  const rows = terms.length
    ? await db
        .select()
        .from(schema.intelSnapshot)
        .where(
          scoped(
            schema.intelSnapshot.organizationId,
            organizationId,
            inArray(schema.intelSnapshot.termId, terms.map((t) => t.id))
          )
        )
        .orderBy(schema.intelSnapshot.day)
    : [];

  const byTerm = new Map<string, Array<{ day: string; value: number; videoCount: number }>>();
  for (const row of rows) {
    const list = byTerm.get(row.termId) ?? [];
    list.push({ day: row.day, value: Number(row.value), videoCount: row.videoCount });
    byTerm.set(row.termId, list);
  }

  const lastValues = terms.map((term) => {
    const history = (byTerm.get(term.id) ?? []).filter(
      (s) => s.day >= start && s.day <= end
    );
    return history.length > 0 ? history[history.length - 1]!.value : 0;
  });
  const totalLast = lastValues.reduce((a, b) => a + b, 0);

  const items: TermCompareItem[] = terms.map((term, i) => {
    const history = (byTerm.get(term.id) ?? []).filter(
      (s) => s.day >= start && s.day <= end
    );
    const seriesValues = history.map((s) => s.value);
    const recent = seriesValues.slice(-7);
    const prior = seriesValues.slice(0, -7);
    const z = seriesValues.length >= 7 ? growthZ(recent, prior) : null;
    const verdict = classify({ daysWithData: seriesValues.length, z });
    const last = history[history.length - 1];
    return {
      termId: term.id,
      name: term.name,
      seriesPoints: history.map((s) => ({ day: s.day, value: s.value })),
      descriptive: describe(seriesValues),
      z,
      sharePct: totalLast > 0 ? (lastValues[i]! / totalLast) * 100 : 0,
      lastValue: lastValues[i]!,
      videoCount: last?.videoCount ?? 0,
      classification: verdict.classification,
    };
  });

  return { terms: items, generatedAt: new Date().toISOString() };
}

/* ────────────────────────────────────────────────────────────────────────────
   Google Trends (ADR-001 · bandera INTEL_GT).
   La serie GT manda (índice 0–100); las vistas YouTube son fallback
   normalizado. Fuentes declaradas siempre en la UI.
   ──────────────────────────────────────────────────────────────────────────── */

export type GtIngestResult = {
  termId: string;
  ok: boolean;
  points: number;
  regions: number;
  related: number;
  partial: boolean;
  reason?: string;
};

/**
 * Ingesta de Google Trends para UN término. Guarda la serie diaria, las
 * regiones y los relacionados en sus tablas GT (dedupe por día, re-ejecutable).
 * Nunca lanza: cualquier fallo devuelve `ok=false` con razón.
 */
export async function runGtIngest(
  organizationId: string,
  termId: string,
  geo = "MX"
): Promise<GtIngestResult> {
  const db = getDb();
  const termRows = await db
    .select()
    .from(schema.intelTerm)
    .where(
      scoped(schema.intelTerm.organizationId, organizationId, eq(schema.intelTerm.id, termId))
    )
    .limit(1);
  const term = termRows[0];
  if (!term) {
    return { termId, ok: false, points: 0, regions: 0, related: 0, partial: false, reason: "Término no encontrado." };
  }

  const { fetchGt } = await import("@/server/intel/sources/google-trends");
  const data = await fetchGt(term.name, geo, "now 7-d");
  const day = utcDay();

  let points = 0;
  let regions = 0;
  let related = 0;

  if (data.timeSeries && data.timeSeries.points.length > 0) {
    const index = toIndex(data.timeSeries.points.map((p) => p.value));
    for (let i = 0; i < data.timeSeries.points.length; i++) {
      const p = data.timeSeries.points[i]!;
      // El timestamp de GT puede ser de días previos; convertimos a día UTC.
      const pointDay = utcDay(new Date(p.time));
      await db
        .insert(schema.intelGtSnapshot)
        .values({
          id: newId("intelGtSnapshot"),
          organizationId,
          termId,
          day: pointDay,
          value: index[i] ?? 0,
        })
        .onConflictDoUpdate({
          target: [schema.intelGtSnapshot.termId, schema.intelGtSnapshot.day],
          set: { value: index[i] ?? 0 },
        });
      points += 1;
    }
  }

  // Regiones: mapeamos geoCode de Google → clave INEGI si coincide (2 dígitos).
  for (const r of data.regions) {
    const state = r.geoCode.padStart(2, "0");
    if (!/^\d{2}$/.test(state)) continue;
    await db
      .insert(schema.intelGtRegion)
      .values({
        id: newId("intelGtRegion"),
        organizationId,
        termId,
        state,
        value: r.value,
        day,
      })
      .onConflictDoUpdate({
        target: [schema.intelGtRegion.termId, schema.intelGtRegion.state, schema.intelGtRegion.day],
        set: { value: r.value },
      });
    regions += 1;
  }

  // Relacionados (temas y consultas)
  for (const r of [...data.topics, ...data.queries]) {
    const kind = data.topics.includes(r) ? "topic" : "query";
    const label = r.label.slice(0, 300);
    await db
      .insert(schema.intelGtRelated)
      .values({
        id: newId("intelGtRelated"),
        organizationId,
        termId,
        kind,
        label,
        value: r.value,
        pct: r.pct !== null ? Math.round(r.pct) : null,
        isBreakout: r.isBreakout,
        day,
      })
      .onConflictDoUpdate({
        target: [schema.intelGtRelated.termId, schema.intelGtRelated.kind, schema.intelGtRelated.label, schema.intelGtRelated.day],
        set: { value: r.value, pct: r.pct !== null ? Math.round(r.pct) : null, isBreakout: r.isBreakout },
      });
    related += 1;
  }

  return { termId, ok: points > 0 || regions > 0 || related > 0, points, regions, related, partial: data.partial };
}

export type GtReport = {
  termId: string;
  termName: string;
  /** Serie GT 0–100 (máx de la ventana = 100). */
  series: Array<{ day: string; value: number }>;
  /** Fuente real de la serie (para el tooltip). */
  seriesSource: "google_trends" | "youtube_fallback" | "none";
  /** Regiones 0–100 (GT) o DENUE (fallback, normalizado). */
  regions: Array<{ state: string; index: number; source: "google_trends" | "denue" }>;
  regionsSource: "google_trends" | "denue" | "none";
  topics: Array<{ label: string; value: number; pct: number | null; isBreakout: boolean }>;
  queries: Array<{ label: string; value: number; pct: number | null; isBreakout: boolean }>;
  /** true si GT no respondió y se usó fallback YouTube. */
  usedFallback: boolean;
  method: { fuente: string; ventana: string };
  generatedAt: string;
};

/**
 * Lee el reporte GT de un término desde la BD (lo que ya se ingirió).
 * Si GT está deshabilitado (checkbox de BD) o no tiene datos, cae a la serie
 * YouTube normalizada 0–100 (fallback declarado). Regiones: si GT no tiene,
 * usa DENUE normalizado.
 */
export async function getGtReport(
  organizationId: string,
  termId: string
): Promise<GtReport | null> {
  const db = getDb();
  const termRows = await db
    .select()
    .from(schema.intelTerm)
    .where(
      scoped(schema.intelTerm.organizationId, organizationId, eq(schema.intelTerm.id, termId))
    )
    .limit(1);
  const term = termRows[0];
  if (!term) return null;

  // Si GT está deshabilitado, no se leen las tablas GT: fallback directo.
  const creds = await getIntelCredentials(organizationId);
  const gtActive = creds?.gtEnabled ?? false;

  const end = utcDay();
  const start = addDays(end, -27);

  // Serie GT (solo si está habilitado)
  const gtRows = gtActive
    ? await db
        .select()
        .from(schema.intelGtSnapshot)
        .where(
          scoped(schema.intelGtSnapshot.organizationId, organizationId, eq(schema.intelGtSnapshot.termId, termId))
        )
        .orderBy(schema.intelGtSnapshot.day)
    : [];

  let series: GtReport["series"] = [];
  let seriesSource: GtReport["seriesSource"] = "none";
  if (gtRows.length > 0) {
    series = gtRows.map((r) => ({ day: r.day, value: r.value }));
    seriesSource = "google_trends";
  } else {
    // Fallback YouTube → normalizado 0–100
    const ytRows = await db
      .select()
      .from(schema.intelSnapshot)
      .where(
        scoped(schema.intelSnapshot.organizationId, organizationId, eq(schema.intelSnapshot.termId, termId))
      )
      .orderBy(schema.intelSnapshot.day);
    const filtered = ytRows.filter((s) => s.day >= start && s.day <= end);
    if (filtered.length > 0) {
      const raw = filtered.map((s) => Number(s.value));
      const idx = toIndex(raw);
      series = filtered.map((s, i) => ({ day: s.day, value: idx[i] ?? 0 }));
      seriesSource = "youtube_fallback";
    }
  }

  // Regiones GT (solo si está habilitado)
  const gtRegionRows = gtActive
    ? await db
        .select()
        .from(schema.intelGtRegion)
        .where(
          scoped(schema.intelGtRegion.organizationId, organizationId, eq(schema.intelGtRegion.termId, termId))
        )
        .orderBy(schema.intelGtRegion.day)
    : [];

  let regions: GtReport["regions"] = [];
  let regionsSource: GtReport["regionsSource"] = "none";
  if (gtRegionRows.length > 0) {
    const byState = new Map<string, number>();
    for (const r of gtRegionRows) {
      byState.set(r.state, r.value);
    }
    regions = [...byState.entries()].map(([state, value]) => ({
      state,
      index: value,
      source: "google_trends" as const,
    }));
    regionsSource = "google_trends";
  }

  // Relacionados (solo si está habilitado)
  const relatedRows = gtActive
    ? await db
        .select()
        .from(schema.intelGtRelated)
        .where(
          scoped(schema.intelGtRelated.organizationId, organizationId, eq(schema.intelGtRelated.termId, termId))
        )
        .orderBy(desc(schema.intelGtRelated.day))
    : [];

  const topics = relatedRows
    .filter((r) => r.kind === "topic")
    .slice(0, 5)
    .map((r) => ({ label: r.label, value: r.value, pct: r.pct, isBreakout: r.isBreakout }));
  const queries = relatedRows
    .filter((r) => r.kind === "query")
    .slice(0, 5)
    .map((r) => ({ label: r.label, value: r.value, pct: r.pct, isBreakout: r.isBreakout }));

  const usedFallback = seriesSource === "youtube_fallback" || regionsSource === "none";

  return {
    termId,
    termName: term.name,
    series,
    seriesSource,
    regions,
    regionsSource,
    topics,
    queries,
    usedFallback,
    method: {
      fuente:
        seriesSource === "google_trends"
          ? "Google Trends (endpoint no oficial)"
          : "YouTube mostPopular (fallback, normalizado 0–100)",
      ventana: "últimos 28 días",
    },
    generatedAt: new Date().toISOString(),
  };
}
