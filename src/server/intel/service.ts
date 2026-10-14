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
