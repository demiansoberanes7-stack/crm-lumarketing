/**
 * Cliente mínimo de la Google Business Profile API v4 para reseñas.
 *
 * scopes: `business.manage` (administrar el perfil del negocio). El patrón de
 * credenciales es el mismo que el calendario (ADR-002): el dueño autoriza una
 * vez y pega el refresh token; el CRM mints access tokens cuando necesita.
 *
 * Endpoints usados (v4, REST):
 * - accounts: mybusinessaccountmanagement v1/accounts
 * - locations: mybusiness v4/accounts/{a}/locations
 * - reviews:  mybusiness v4/accounts/{a}/locations/{l}/reviews
 * - reply:    mybusiness v4/{reviewName} PATCH updateMask=reviewReply.comment
 */

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCOUNTS_BASE = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_BASE = "https://mybusiness.googleapis.com/v4";

const TIMEOUT_MS = 20_000;

export type GbLocation = {
  name: string;
  displayName: string | null;
  averageRating: number | null;
  reviewCount: number;
};

export type GbReview = {
  name: string;
  reviewerName: string | null;
  rating: number;
  comment: string | null;
  createTime: string;
  updateTime: string | null;
  replyComment: string | null;
};

async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      status: 0,
      body: {
        message: timedOut
          ? "Google no respondió a tiempo"
          : "No se pudo contactar con Google",
      },
    };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, body };
}

/** Intercambia el refresh token por un access token de corta vida. */
export async function exchangeAccessToken(creds: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string } | { error: string }> {
  const response = await fetchJson(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const accessToken =
    typeof response.body?.access_token === "string" ? response.body.access_token : "";
  if (response.ok && accessToken) return { accessToken };
  const error =
    typeof response.body?.error === "string"
      ? response.body.error
      : `HTTP ${response.status}`;
  return { error };
}

type AuthedRequest = {
  accessToken: string;
};

function authHeaders(token: AuthedRequest["accessToken"]): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Cuentas de negocio a las que el usuario tiene acceso. */
export async function listAccounts(
  token: AuthedRequest
): Promise<{ accounts: string[] } | { error: string }> {
  const response = await fetchJson(`${ACCOUNTS_BASE}/accounts`, {
    headers: authHeaders(token.accessToken),
  });
  if (!response.ok) {
    return {
      error:
        typeof response.body?.message === "string"
          ? response.body.message
          : `HTTP ${response.status}`,
    };
  }
  const raw = Array.isArray(response.body?.accounts) ? (response.body.accounts as Record<string, unknown>[]) : [];
  const accounts = raw
    .map((a) => (typeof a.name === "string" ? a.name : null))
    .filter((name): name is string => Boolean(name));
  return { accounts };
}

/** Ubicaciones de una cuenta, con rating y conteo de reseñas. */
export async function listLocations(
  token: AuthedRequest,
  accountName: string
): Promise<{ locations: GbLocation[] } | { error: string }> {
  const url = new URL(`${BUSINESS_BASE}/${accountName}/locations`);
  url.searchParams.set("pageSize", "50");
  const response = await fetchJson(url.toString(), {
    headers: authHeaders(token.accessToken),
  });
  if (!response.ok) {
    return {
      error:
        typeof response.body?.message === "string"
          ? response.body.message
          : `HTTP ${response.status}`,
    };
  }
  const raw = Array.isArray(response.body?.locations)
    ? (response.body.locations as Record<string, unknown>[])
    : [];
  const locations: GbLocation[] = raw.flatMap((l) => {
    if (typeof l.name !== "string") return [];
    const displayName =
      (l.displayName as { text?: string } | undefined)?.text ??
      (typeof l.title === "string" ? l.title : null);
    const averageRating =
      typeof l.averageRating === "number" ? l.averageRating : null;
    const reviewCount = typeof l.reviewCount === "number" ? l.reviewCount : 0;
    return [{ name: l.name, displayName, averageRating, reviewCount }];
  });
  return { locations };
}

/** Estrellas ONE..FIVE → entero 1-5; cualquier cosa rara cuenta como 0. */
export function parseStarRating(raw: unknown): number {
  const map: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  };
  if (typeof raw === "string" && map[raw]) return map[raw]!;
  if (typeof raw === "number" && raw >= 1 && raw <= 5) return Math.round(raw);
  return 0;
}

/** Reseñas de una ubicación (lista completa; la API pagina con pageToken). */
export async function listReviews(
  token: AuthedRequest,
  locationName: string
): Promise<{ reviews: GbReview[] } | { error: string }> {
  const reviews: GbReview[] = [];
  let pageToken: string | null = null;
  do {
    const url = new URL(`${BUSINESS_BASE}/${locationName}/reviews`);
    url.searchParams.set("pageSize", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetchJson(url.toString(), {
      headers: authHeaders(token.accessToken),
    });
    if (!response.ok) {
      return {
        error:
          typeof response.body?.message === "string"
            ? response.body.message
            : `HTTP ${response.status}`,
      };
    }
    const raw = Array.isArray(response.body?.reviews)
      ? (response.body.reviews as Record<string, unknown>[])
      : [];
    for (const r of raw) {
      if (typeof r.name !== "string") continue;
      const reviewer = r.reviewer as { displayName?: string; isAnonymous?: boolean } | undefined;
      const reply = r.reviewReply as { comment?: string } | undefined;
      reviews.push({
        name: r.name,
        reviewerName:
          reviewer?.isAnonymous === true
            ? null
            : typeof reviewer?.displayName === "string" && reviewer.displayName
              ? reviewer.displayName
              : null,
        rating: parseStarRating(r.starRating),
        comment: typeof r.comment === "string" && r.comment ? r.comment : null,
        createTime: typeof r.createTime === "string" ? r.createTime : new Date().toISOString(),
        updateTime: typeof r.updateTime === "string" ? r.updateTime : null,
        replyComment: typeof reply?.comment === "string" && reply.comment ? reply.comment : null,
      });
    }
    pageToken =
      typeof response.body?.nextPageToken === "string" && response.body.nextPageToken
        ? response.body.nextPageToken
        : null;
  } while (pageToken && reviews.length < 500);
  return { reviews };
}

/**
 * Publica (o actualiza) la respuesta del negocio a una reseña.
 * El reply es PÚBLICO: lo ven todos los que vean la reseña.
 */
export async function updateReviewReply(
  token: AuthedRequest,
  reviewName: string,
  comment: string
): Promise<{ ok: true } | { error: string }> {
  const url = new URL(`${BUSINESS_BASE}/${reviewName}`);
  url.searchParams.set("updateMask", "reviewReply.comment");
  const response = await fetchJson(url.toString(), {
    method: "PATCH",
    headers: { ...authHeaders(token.accessToken), "content-type": "application/json" },
    body: JSON.stringify({ reviewReply: { comment } }),
  });
  if (!response.ok) {
    return {
      error:
        typeof response.body?.message === "string"
          ? response.body.message
          : `HTTP ${response.status}`,
    };
  }
  return { ok: true };
}
