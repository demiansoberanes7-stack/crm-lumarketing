import { createSign } from "node:crypto";

/**
 * Cliente de Google Analytics 4 (Data API) por REST directo, sin SDK.
 *
 * La constitución no admite dependencias nuevas para conectores, así que el
 * acceso se hace con un JWT RS256 firmado a mano (service account) contra el
 * endpoint de intercambio de Google y de ahí a la Data API v1beta.
 *
 * Credenciales: `serviceAccountJson` (el JSON descargado de Google Cloud con
 * `client_email` y `private_key`) + `propertyId` de la propiedad GA4. La
 * service account necesita el rol *Observador de datos* en la propiedad.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_URL = "https://analyticsdata.googleapis.com/v1beta";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
/** Margen para que el token no expire en vuelo. */
const TOKEN_TTL_S = 3600;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
/**
 * Cortes por petición. Sin ellos, un Google colgado deja el botón de prueba y
 * el dashboard de marketing esperando indefinidamente: el token tarda poco, el
 * reporte puede ser lento, ninguno merece esperar para siempre.
 */
const TOKEN_TIMEOUT_MS = 15_000;
const REPORT_TIMEOUT_MS = 30_000;

/**
 * `grant_type` del intercambio JWT → token.
 *
 * Google exige el valor COMPLETO (`urn:ietf:params:oauth:grant-type:jwt-bearer`).
 * Con el apócrifo `jwt-bearer` responde 400 `invalid_grant` /
 * "Invalid grant_type: jwt-bearer" y ni la prueba de conexión ni el dashboard
 * de marketing podían leer nada.
 */
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface Ga4Credentials {
  propertyId: string;
  serviceAccountJson: string;
}

export interface Ga4Metrics {
  sessions: number;
  users: number;
  newUsers: number;
  bounceRate: number;
  sources: Array<{ name: string; sessions: number }>;
  daily: Array<{ date: string; sessions: number }>;
}

export class Ga4Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Ga4Error";
  }
}

/** Extrae y valida las credenciales guardadas; null si están incompletas. */
export function parseGa4Credentials(credentials: Record<string, unknown>): Ga4Credentials | null {
  const propertyId = credentials.propertyId;
  const raw = credentials.serviceAccountJson ?? credentials.serviceAccountKey;
  if (typeof propertyId !== "string" || !propertyId.trim()) return null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return { propertyId: propertyId.trim(), serviceAccountJson: raw };
}

function parseServiceAccount(json: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Ga4Error("El JSON de la service account no es válido");
  }
  const account = parsed as Partial<ServiceAccount>;
  if (typeof account.client_email !== "string" || typeof account.private_key !== "string") {
    throw new Ga4Error("El JSON falta `client_email` o `private_key` (usa el archivo completo de la service account)");
  }
  return { client_email: account.client_email, private_key: account.private_key };
}

/** JWT firmado con RS256 para el flujo de service account. */
function signJwt(account: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + TOKEN_TTL_S,
    })
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(account.private_key).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Caché mínima de tokens: la clave incluye el email y un hash de la clave. */
type TokenEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenEntry>();

type TokenFailure = { error?: string; error_description?: string };

/**
 * Traduce el rechazo del canjear a lo que el dueño puede ARREGLAR.
 *
 * El texto crudo de Google está en inglés y describe el protocolo, no la causa
 * práctica: "Invalid JWT: signature verification failed" significa que la
 * `private_key` del JSON no corresponde al cliente_email — otra vez casi siempre
 * por pegar el JSON a medias o con los `\n` convertidos.
 */
function tokenErrorMessage(status: number, payload: TokenFailure | null): string {
  const detail = [payload?.error, payload?.error_description].filter(Boolean).join(": ");
  const low = detail.toLowerCase();
  const hint =
    low.includes("signature") || low.includes("private key") || low.includes("invalid jwt")
      ? "La `private_key` del JSON no sirve para firmar: revisa que esté completa y con sus saltos de línea."
      : payload?.error === "invalid_client" || payload?.error === "unauthorized_client"
        ? "Google no reconoce esa service account para pedir tokens."
        : null;
  const raw = detail || `Google rechazó las credenciales (HTTP ${status})`;
  return hint ? `${hint} (${raw})` : raw;
}

/** `fetch` con corte: nunca deja una petición abierta para siempre. */
async function boundedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new Ga4Error(
      timedOut
        ? `Google no respondió en ${Math.round(timeoutMs / 1000)} s`
        : `No se pudo contactar a Google: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const cacheKey = `${account.client_email}:${account.private_key.length}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > TOKEN_EXPIRY_MARGIN_MS) return cached.token;

  const body = new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion: signJwt(account) });
  const response = await boundedFetch(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
    TOKEN_TIMEOUT_MS
  );
  const payload = (await response.json().catch(() => null)) as (TokenFailure & { access_token?: string }) | null;
  if (!response.ok || !payload?.access_token) {
    throw new Ga4Error(tokenErrorMessage(response.status, payload));
  }
  tokenCache.set(cacheKey, {
    token: payload.access_token,
    expiresAt: Date.now() + TOKEN_TTL_S * 1000,
  });
  return payload.access_token;
}

interface RunReportResponse {
  rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>;
  metadata?: { currencyCode?: string };
}

async function runReport(
  creds: Ga4Credentials,
  body: Record<string, unknown>
): Promise<RunReportResponse> {
  const account = parseServiceAccount(creds.serviceAccountJson);
  const token = await getAccessToken(account);
  const response = await boundedFetch(
    `${DATA_URL}/properties/${encodeURIComponent(creds.propertyId)}:runReport`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
    REPORT_TIMEOUT_MS
  );
  const payload = (await response.json().catch(() => null)) as
    | (RunReportResponse & { error?: { message?: string } })
    | null;
  if (!response.ok) {
    const detail = payload?.error?.message || `Google Analytics Data API respondió ${response.status}`;
    // 403 suele ser permiso de la propiedad y no credencial mala: decirlo
    // ahorra el ciclo "revisar el JSON" cuando lo que falta es el rol.
    throw new Ga4Error(
      response.status === 403
        ? `Sin permiso sobre la propiedad ${creds.propertyId}: dale el rol Observador de datos (o Analytics Data Viewer) a la service account. (${detail})`
        : detail
    );
  }
  return payload ?? {};
}

function number(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Prueba de conexión: corre un reporte mínimo (últimos 7 días, 1 fila). */
export async function testGa4Connection(creds: Ga4Credentials): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    const today = new Date();
    const from = new Date(today.getTime() - 7 * 86_400_000);
    const report = await runReport(creds, {
      dateRanges: [{ startDate: isoDate(from), endDate: isoDate(today) }],
      metrics: [{ name: "sessions" }],
      limit: 1,
    });
    const sessions = number(report.rows?.[0]?.metricValues?.[0]?.value);
    return {
      ok: true,
      message: `Conectado a la propiedad ${creds.propertyId}: ${sessions} sesiones en los últimos 7 días.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Lee las métricas que promete la UI: sesiones, usuarios, tasa de rebote,
 * fuentes de tráfico y la serie diaria de sesiones (últimos 30 días).
 */
export async function readGa4Metrics(creds: Ga4Credentials): Promise<Ga4Metrics> {
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 86_400_000);
  const dateRange = { startDate: isoDate(from), endDate: isoDate(today) };

  const [totals, bySource, daily] = await Promise.all([
    runReport(creds, {
      dateRanges: [dateRange],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "newUsers" }, { name: "bounceRate" }],
      limit: 1,
    }),
    runReport(creds, {
      dateRanges: [dateRange],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 8,
    }),
    runReport(creds, {
      dateRanges: [dateRange],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 31,
    }),
  ]);

  const totalsRow = totals.rows?.[0]?.metricValues ?? [];
  return {
    sessions: number(totalsRow[0]?.value),
    users: number(totalsRow[1]?.value),
    newUsers: number(totalsRow[2]?.value),
    bounceRate: number(totalsRow[3]?.value),
    sources: (bySource.rows ?? []).map((row) => ({
      name: row.dimensionValues[0]?.value || "(sin canal)",
      sessions: number(row.metricValues[0]?.value),
    })),
    daily: (daily.rows ?? []).map((row) => ({
      date: row.dimensionValues[0]?.value || "",
      sessions: number(row.metricValues[0]?.value),
    })),
  };
}
