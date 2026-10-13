/**
 * Cliente mínimo de la API de Mercado Libre para mensajería post-venta.
 *
 * Endpoints usados (global-selling, REST):
 * - refresh:  POST /oauth/token (grant_type=refresh_token)
 * - me:       GET  /users/me
 * - unread:   GET  /marketplace/messages/unread?role=seller&tag=post_sale
 * - pack:     GET  /marketplace/messages/packs/{packId}?mark_as_read=false&tag=post_sale
 * - send:     POST /marketplace/messages/packs/{packId}  { text }
 */

const API_BASE = "https://api.mercadolibre.com";
const TIMEOUT_MS = 20_000;

export type MlMessage = {
  id: string;
  from: { user_id: number; name: string | null };
  to: { user_id: number; name: string | null };
  text: string | null;
  /** Fecha ISO del mensaje (received/created). */
  date: string | null;
  /** Nombres de archivo de adjuntos, si los hay. */
  attachments: string[];
};

type FetchResult = { ok: boolean; status: number; body: Record<string, unknown> | null };

async function fetchJson(
  url: string,
  init?: RequestInit
): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      status: 0,
      body: { message: timedOut ? "Mercado Libre no respondió a tiempo" : "No se pudo contactar con Mercado Libre" },
    };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, body };
}

function errorMessage(result: FetchResult): string {
  const raw = result.body?.message;
  return typeof raw === "string" && raw
    ? raw
    : result.status === 0
      ? "Mercado Libre no está disponible"
      : `Mercado Libre respondió ${result.status}`;
}

function isAuthFailure(result: FetchResult): boolean {
  return result.status === 401 || result.status === 403;
}

export type MlToken = {
  accessToken: string;
  /** ML puede rotar el refresh token en el mismo intercambio. */
  refreshToken: string | null;
  expiresIn: number;
  userId: string | null;
  siteId: string | null;
};

/** Intercambia el refresh token por un access token de corta vida. */
export async function refreshAccessToken(creds: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ token: MlToken } | { error: string; authError: boolean }> {
  const result = await fetchJson(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
    }),
  });
  if (!result.ok) {
    return { error: errorMessage(result), authError: isAuthFailure(result) };
  }
  const body = result.body ?? {};
  const accessToken = typeof body.access_token === "string" ? body.access_token : null;
  if (!accessToken) return { error: "Mercado Libre no devolvió access token", authError: false };
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 21600;
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : null;
  const userId = body.user_id != null ? String(body.user_id) : null;
  const siteId = typeof body.site_id === "string" ? body.site_id : null;
  return { token: { accessToken, refreshToken, expiresIn, userId, siteId } };
}

/** Identidad de la cuenta vendedora autenticada (se guarda al conectar). */
export async function getMe(
  accessToken: string
): Promise<{ userId: string; siteId: string | null } | { error: string; authError: boolean }> {
  const result = await fetchJson(`${API_BASE}/users/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!result.ok) {
    return { error: errorMessage(result), authError: isAuthFailure(result) };
  }
  const body = result.body ?? {};
  const id = body.id ?? body.user_id;
  if (id == null) return { error: "Mercado Libre no devolvió el id del usuario", authError: false };
  const siteId = typeof body.site_id === "string" ? body.site_id : null;
  return { userId: String(id), siteId };
}

/** Packs (conversaciones post-venta) con mensajes sin leer para el vendedor. */
export async function listUnreadPacks(
  accessToken: string
): Promise<{ packIds: string[] } | { error: string; authError: boolean }> {
  const result = await fetchJson(
    `${API_BASE}/marketplace/messages/unread?role=seller&tag=post_sale`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  if (!result.ok) {
    return { error: errorMessage(result), authError: isAuthFailure(result) };
  }
  const results = Array.isArray(result.body?.results) ? (result.body?.results as unknown[]) : [];
  const packIds: string[] = [];
  for (const entry of results) {
    if (!entry || typeof entry !== "object") continue;
    const resource = (entry as Record<string, unknown>).resource;
    if (typeof resource !== "string") continue;
    const match = /\/packs\/(\d+)/.exec(resource);
    if (match?.[1]) packIds.push(match[1]);
  }
  return { packIds };
}

/** Historial de mensajes de un pack (sin marcarlo como leído). */
export async function listPackMessages(
  accessToken: string,
  packId: string
): Promise<{ messages: MlMessage[] } | { error: string; authError: boolean }> {
  const result = await fetchJson(
    `${API_BASE}/marketplace/messages/packs/${encodeURIComponent(packId)}?mark_as_read=false&tag=post_sale&limit=50`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  if (!result.ok) {
    return { error: errorMessage(result), authError: isAuthFailure(result) };
  }
  const raw = Array.isArray(result.body?.messages) ? (result.body?.messages as unknown[]) : [];
  const messages: MlMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const m = entry as Record<string, unknown>;
    if (typeof m.id !== "string") continue;
    const from = (m.from ?? {}) as Record<string, unknown>;
    const to = (m.to ?? {}) as Record<string, unknown>;
    const dates = (m.message_date ?? {}) as Record<string, unknown>;
    const attachmentsRaw = Array.isArray(m.message_attachments)
      ? (m.message_attachments as unknown[])
      : [];
    const attachments = attachmentsRaw
      .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>).filename : null))
      .filter((f): f is string => typeof f === "string");
    messages.push({
      id: m.id,
      from: {
        user_id: typeof from.user_id === "number" ? from.user_id : Number(from.user_id ?? 0),
        name: typeof from.name === "string" && from.name ? from.name : null,
      },
      to: {
        user_id: typeof to.user_id === "number" ? to.user_id : Number(to.user_id ?? 0),
        name: typeof to.name === "string" && to.name ? to.name : null,
      },
      text: typeof m.text === "string" ? m.text : null,
      date:
        typeof dates.received === "string"
          ? dates.received
          : typeof dates.created === "string"
            ? dates.created
            : null,
      attachments,
    });
  }
  return { messages };
}

/**
 * Envía un mensaje de texto al comprador de un pack. La API admite hasta 350
 * caracteres (latin1); el límite se declara en capabilities y se pre-chequea
 * en el guard de envío.
 */
export async function sendPackMessage(
  accessToken: string,
  packId: string,
  text: string
): Promise<{ ok: true } | { error: string; authError: boolean }> {
  const result = await fetchJson(
    `${API_BASE}/marketplace/messages/packs/${encodeURIComponent(packId)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text }),
    }
  );
  if (!result.ok) {
    return { error: errorMessage(result), authError: isAuthFailure(result) };
  }
  return { ok: true };
}
