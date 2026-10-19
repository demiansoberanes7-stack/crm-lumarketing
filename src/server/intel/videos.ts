import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getIntelCredentials, markIntelIngested } from "@/server/intel/credentials";
import { utcDay } from "@/server/intel/service";
import { listActiveTerms } from "@/server/intel/terms";
import { matchTerms, youtubeSource } from "@/server/intel/sources/youtube";

/**
 * Ingesta de YouTube (mostPopular MX) sobre los nichos monitoreados.
 *
 * El conector, la tabla `intel_video` y el analizador `/api/intel/content`
 * ya existían, pero NADIE insertaba en la tabla: el panel de contenido
 * siempre iba a estar vacío. Aquí se cierra ese tramo del flujo:
 * leer feed → contraer contra las keywords del catálogo → persistir el día.
 *
 * Cuesta 1 unidad de las 10 000 diarias gratuitas (es un solo `videos.list`
 * para todos los nichos), así que se corre junto a la ingesta global.
 * Sin key de YouTube no hay de dónde leer: se reporta el motivo y la UI
 * lo dice, nunca se rellena con datos de otra fuente.
 */

export type YoutubeIngestResult = {
  ok: boolean;
  /** Videos-muestra del feed leídos en esta corrida. */
  fetched: number;
  /** Filas escritas (un video puede contar en varios nichos). */
  rows: number;
  /** Nichos que coincidieron con al menos un video. */
  matchedTerms: number;
  reason?: string;
};

const MAX_RESULTS = 50;

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export async function runYoutubeIngest(
  organizationId: string
): Promise<YoutubeIngestResult> {
  const empty: YoutubeIngestResult = {
    ok: false,
    fetched: 0,
    rows: 0,
    matchedTerms: 0,
  };

  const creds = await getIntelCredentials(organizationId);
  const apiKey = creds?.youtubeKey;
  if (!apiKey) return { ...empty, reason: "missing_youtube_key" };

  const videos = await youtubeSource.listMostPopular(apiKey, "MX", MAX_RESULTS);
  if (videos.length === 0) return { ...empty, reason: "empty_feed" };

  const terms = await listActiveTerms(organizationId);
  if (terms.length === 0) return { ...empty, fetched: videos.length, reason: "no_terms" };

  const byTerm = matchTerms(
    videos,
    terms.map((t) => ({ id: t.id, keywords: t.keywords }))
  );

  const db = getDb();
  const day = utcDay();
  let rows = 0;
  let matchedTerms = 0;

  for (const [termId, matches] of byTerm) {
    if (matches.length === 0) continue;
    matchedTerms += 1;
    for (const video of matches) {
      const values = {
        title: video.title.slice(0, 300),
        views: video.views,
        likes: video.likes,
        durationSeconds: video.durationSeconds,
        publishedAt: toDate(video.publishedAt),
        channelTitle: video.channelTitle ? video.channelTitle.slice(0, 200) : null,
      };
      await db
        .insert(schema.intelVideo)
        .values({
          id: newId("intelVideo"),
          organizationId,
          termId,
          videoId: video.videoId.slice(0, 40),
          day,
          ...values,
        })
        .onConflictDoUpdate({
          target: [schema.intelVideo.termId, schema.intelVideo.videoId, schema.intelVideo.day],
          set: values,
        });
      rows += 1;
    }
  }

  if (rows > 0) await markIntelIngested(organizationId);

  return { ok: rows > 0, fetched: videos.length, rows, matchedTerms };
}
