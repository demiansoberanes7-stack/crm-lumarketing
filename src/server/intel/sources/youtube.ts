import { normalizeText } from "@/server/intel/stats";

/**
 * Conector de YouTube Data API v3 (capa gratuita): lee los videos más
 * populares de la región (MX) y los contrae contra los términos monitoreados.
 * El `part=statistics` cuenta en 1 unidad de cuota por llamada; con
 * maxResults=50 la ingesta diaria cuesta ~1 unidad de las 10 000 gratis.
 */

const YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3";

export type PopularVideo = {
  videoId: string;
  title: string;
  description: string;
  views: number;
  likes: number;
  /** Duración en segundos (ISO 8601 del API → number). null si falta. */
  durationSeconds: number | null;
  /** Fecha de publicación del video. null si falta. */
  publishedAt: string | null;
  channelTitle: string | null;
};

/** Parsea la duración ISO 8601 de YouTube (PT#H#M#S) a segundos. */
export function parseDurationSeconds(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  const total = h * 3600 + min * 60 + s;
  return total > 0 ? total : null;
}

export class YoutubeError extends Error {
  constructor(
    message: string,
    readonly kind: "unauthorized" | "network" | "unexpected"
  ) {
    super(message);
    this.name = "YoutubeError";
  }
}

type YoutubeListResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      channelTitle?: string;
    };
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string; likeCount?: string };
  }>;
  error?: { message?: string };
};

async function listMostPopular(
  apiKey: string,
  regionCode: string,
  maxResults: number
): Promise<PopularVideo[]> {
  const params = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    chart: "mostPopular",
    regionCode,
    maxResults: String(maxResults),
    key: apiKey,
  });
  let response: Response;
  try {
    response = await fetch(`${YOUTUBE_BASE}/videos?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new YoutubeError("YouTube no respondió a tiempo", "network");
  }
  if (response.status === 401 || response.status === 403) {
    throw new YoutubeError("YouTube rechazó la API key", "unauthorized");
  }
  const payload = (await response.json().catch(() => null)) as
    | YoutubeListResponse
    | null;
  if (!response.ok || !payload || payload.error) {
    throw new YoutubeError(
      payload?.error?.message ?? `YouTube respondió ${response.status}`,
      "unexpected"
    );
  }
  const items = payload.items ?? [];
  const videos: PopularVideo[] = [];
  for (const item of items) {
    if (!item?.id) continue;
    videos.push({
      videoId: item.id,
      title: item.snippet?.title ?? "",
      description: item.snippet?.description ?? "",
      views: Number(item.statistics?.viewCount ?? 0) || 0,
      likes: Number(item.statistics?.likeCount ?? 0) || 0,
      durationSeconds: item.contentDetails?.duration
        ? parseDurationSeconds(item.contentDetails.duration)
        : null,
      publishedAt: item.snippet?.publishedAt ?? null,
      channelTitle: item.snippet?.channelTitle ?? null,
    });
  }
  return videos;
}

/**
 * Verifica que la API key sirva para leer el feed popular (1 unidad de
 * cuota). Se llama antes de guardar, igual que Google Business verifica sus
 * credenciales: si el dueño pegó algo malo, lo sabe aquí y no se persiste.
 */
export async function verifyYoutubeKey(apiKey: string): Promise<true> {
  await listMostPopular(apiKey, "MX", 1);
  return true;
}

export type TermMatch = {
  videoId: string;
  title: string;
  views: number;
  likes: number;
  durationSeconds: number | null;
  publishedAt: string | null;
  channelTitle: string | null;
};

/**
 * Contrae cada video contra cada término: match si el título o la
 * descripción normalizados contienen alguna keyword del término.
 */
export function matchTerms(
  videos: PopularVideo[],
  terms: Array<{ id: string; keywords: string[] }>
): Map<string, TermMatch[]> {
  const normalized = videos.map((video) => ({
    ...video,
    haystack: normalizeText(`${video.title} ${video.description}`),
  }));
  const byTerm = new Map<string, TermMatch[]>();
  for (const term of terms) {
    const keywords = term.keywords.map((k) => normalizeText(k)).filter(Boolean);
    if (keywords.length === 0) continue;
    const matches: TermMatch[] = [];
    for (const video of normalized) {
      if (keywords.some((k) => video.haystack.includes(k))) {
        matches.push({
          videoId: video.videoId,
          title: video.title,
          views: video.views,
          likes: video.likes,
          durationSeconds: video.durationSeconds,
          publishedAt: video.publishedAt,
          channelTitle: video.channelTitle,
        });
      }
    }
    byTerm.set(term.id, matches);
  }
  return byTerm;
}

export const youtubeSource = {
  listMostPopular: (apiKey: string, regionCode = "MX", maxResults = 50) =>
    listMostPopular(apiKey, regionCode, maxResults),
};
