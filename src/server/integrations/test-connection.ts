/**
 * Prueba de conexión de las integraciones del Marketing.
 *
 * Tres estados y no dos: `connected` solo cuando el proveedor RESPONDIÓ de
 * verdad, `error` cuando respondió mal o la validación local falló, y `saved`
 * cuando hay credenciales guardadas que no se pueden verificar de extremo a
 * extremo (Google Ads: sin el flujo OAuth no hay con qué leer la cuenta).
 *
 * Ninguna función de aquí lanza: el fallo vuelve como estado, para que la
 * tarjeta lo muestre en vez de romper la pantalla.
 */

import { parseGa4Credentials, testGa4Connection } from "@/server/analytics/ga4";
import { getEnv } from "@/lib/env";

export type ConnectionStatus = "connected" | "error" | "saved" | "missing";
export type ConnectionTest = { status: ConnectionStatus; message: string };

/** Corte por petición: una prueba que no responde no puede dejar colgado el botón. */
const TEST_TIMEOUT_MS = 20_000;

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      status: 0,
      body: { message: timedOut ? "El proveedor no respondió a tiempo" : "No se pudo contactar con el proveedor" },
    };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, body };
}

/* ─── Meta Ads ─── */

/** Graph errors traen datos de diagnóstico que conviene conservar sin secretos. */
type GraphError = {
  error?: {
    message?: string;
    code?: number;
    type?: string;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

/** El id puede venir como `act_123` o como puro número: Graph exige el prefijo. */
export function normalizeAdAccountId(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  return value.startsWith("act_") ? value : `act_${value}`;
}

/** Traduce el code de Graph a lo que hay que hacer, no al protocolo. */
function graphHint(code: number | undefined): string | null {
  switch (code) {
    case 190:
      return "El access token no es válido o ya expiró.";
    case 10:
      return "El token no tiene permiso ads_read sobre esa cuenta.";
    case 200:
      return "Meta bloqueó el acceso a la API para este token, aplicación o negocio; revisa Account Quality y el panel de desarrolladores.";
    case 100:
      return "Graph no reconoce la cuenta: revisa el Ad Account ID.";
    case 80004:
      return "La cuenta de anuncios está inactiva o fue eliminada.";
    default:
      return null;
  }
}

const ACCOUNT_STATUS: Record<number, string> = {
  1: "activa",
  2: "inactiva",
  3: "sin liquidar",
  7: "pendiente de pago",
  8: "cerrada",
  9: "en revisión",
};

export async function testMetaAdsConnection(creds: {
  accessToken: string;
  adAccountId: string;
}): Promise<ConnectionTest> {
  const accessToken = creds.accessToken.trim();
  const adAccountId = normalizeAdAccountId(creds.adAccountId);
  if (!accessToken || !adAccountId) {
    return { status: "missing", message: "Falta el access token o el Ad Account ID." };
  }

  const env = getEnv();
  const graphRoot = `${env.META_GRAPH_BASE_URL.replace(/\/+$/, "")}/${env.META_GRAPH_API_VERSION.replace(/^\/+|\/+$/g, "")}`;
  const url = new URL(`${graphRoot}/${adAccountId}`);
  url.search = new URLSearchParams({
    fields: "name,account_status,currency",
    access_token: accessToken,
  }).toString();

  const { ok, status, body } = await fetchJson(url.toString());
  if (!ok) {
    const graph = (body ?? {}) as GraphError;
    const detail = graph.error?.message ?? `HTTP ${status}`;
    const hint = graphHint(graph.error?.code);
    const diagnostics = [
      graph.error?.type,
      typeof graph.error?.code === "number" ? `code ${graph.error.code}` : null,
      typeof graph.error?.error_subcode === "number" ? `subcode ${graph.error.error_subcode}` : null,
      graph.error?.fbtrace_id ? `fbtrace_id ${graph.error.fbtrace_id}` : null,
    ].filter((value): value is string => Boolean(value));
    const suffix = diagnostics.length ? ` [${diagnostics.join(" · ")}]` : "";
    return {
      status: "error",
      message: hint
        ? `${hint} (${detail})${suffix}`
        : `Meta rechazó las credenciales: ${detail}${suffix}`,
    };
  }

  const name = typeof body?.name === "string" ? body.name : adAccountId;
  const currency = typeof body?.currency === "string" ? body.currency : "";
  const statusCode = typeof body?.account_status === "number" ? body.account_status : 0;
  const estado = ACCOUNT_STATUS[statusCode] ?? (statusCode ? `estado ${statusCode}` : "conocida");
  return {
    status: "connected",
    message: `Conectado a la cuenta «${name}»${currency ? ` (${currency})` : ""} · ${estado}.`,
  };
}

/* ─── Google Ads ─── */

/** `123-456-7890` o `1234567890`; devuelve los dígitos o null si no sirve. */
export function normalizeCustomerId(raw: string): string | null {
  const digits = raw.trim().replace(/-/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
}

/**
 * Intercambia el refresh token pegado por un access token de Google Ads.
 *
 * El patrón es el mismo que Google Calendar (ADR-002): el dueño crea la app
 * OAuth en Google Cloud, autoriza una vez con scope `adwords` y pega el
 * refresh token en el formulario; el CRM nunca ve un callback OAuth. Con el
 * refresh token el CRM puede mintear access tokens cuando quiera.
 */
async function exchangeGoogleAdsAccessToken(creds: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string } | { error: string }> {
  const response = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId.trim(),
      client_secret: creds.clientSecret.trim(),
      refresh_token: creds.refreshToken.trim(),
      grant_type: "refresh_token",
    }).toString(),
  });
  const accessToken = typeof response.body?.access_token === "string" ? response.body.access_token : "";
  if (response.ok && accessToken) return { accessToken };
  const error = typeof response.body?.error === "string" ? response.body.error : `HTTP ${response.status}`;
  return { error };
}

/**
 * Prueba REAL de Google Ads: con refresh token, obtiene un access token y
 * llama `customers:listAccessibleCustomers` — la lista de cuentas a las que
 * el usuario realmente tiene acceso. Solo entonces el estado es `connected`.
 *
 * Sin refresh token se conserva el sondeo legado (verificar el par
 * Client ID/Client Secret con un refresh token ficticio): `saved`, porque
 * leer la cuenta exige el token de acceso que solo produce el flujo OAuth.
 */
export async function testGoogleAdsConnection(creds: {
  customerId: string;
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}): Promise<ConnectionTest> {
  const { customerId, developerToken, clientId, clientSecret, refreshToken } = creds;
  if (!customerId.trim() || !developerToken.trim() || !clientId.trim() || !clientSecret.trim()) {
    return { status: "missing", message: "Faltan datos: completa Customer ID, Developer Token y las credenciales OAuth." };
  }
  if (!normalizeCustomerId(customerId)) {
    return { status: "error", message: "El Customer ID debe ser de 10 dígitos (123-456-7890)." };
  }

  // ── Ruta real: hay refresh token → access token → listAccessibleCustomers ──
  if (refreshToken?.trim()) {
    const token = await exchangeGoogleAdsAccessToken({ clientId, clientSecret, refreshToken });
    if ("error" in token) {
      if (token.error === "invalid_grant") {
        return {
          status: "error",
          message: "El refresh token ya no es válido (invalid_grant): el dueño revocó el acceso o el consentimiento expiró. Autoriza de nuevo y pega el token nuevo.",
        };
      }
      if (token.error === "invalid_client" || token.error === "unauthorized_client") {
        return { status: "error", message: "El Client ID o el Client Secret no son válidos (Google respondió invalid_client)." };
      }
      return { status: "error", message: `Google rechazó el refresh token: ${token.error}` };
    }

    const list = await fetchJson("https://googleads.googleapis.com/v21/customers:listAccessibleCustomers", {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "developer-token": developerToken.trim(),
        "login-customer-id": normalizeCustomerId(customerId) ?? "",
      },
    });
    if (!list.ok) {
      const status = list.status;
      const detail = typeof list.body?.message === "string" ? list.body.message : `HTTP ${status}`;
      if (status === 401 || status === 403) {
        return {
          status: "error",
          message: `Google Ads rechazó el acceso (HTTP ${status}): el Developer Token no tiene acceso o el usuario no autorizó el scope adwords. Detalle: ${detail}`,
        };
      }
      return { status: "error", message: `Google Ads respondió mal: ${detail}` };
    }
    const resources = Array.isArray(list.body?.resourceNames) ? list.body.resourceNames as string[] : [];
    return {
      status: "connected",
      message: `Conectado: el usuario tiene acceso a ${resources.length} cuenta(s) de Google Ads${resources.length ? ` (incluye customers/${normalizeCustomerId(customerId)})` : ""}.`,
    };
  }

  // ── Ruta legada: solo verificar el par Client ID/Client Secret ──
  const response = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      refresh_token: "no-existe-probe-de-credenciales",
      grant_type: "refresh_token",
    }).toString(),
  });

  const error = typeof response.body?.error === "string" ? response.body.error : "";
  if (response.status === 0) {
    return { status: "error", message: String(response.body?.message ?? "No se pudo probar la conexión.") };
  }
  // 200 sería raro (el refresh de mentira no es válido); se trata como par bueno.
  if (response.ok || error === "invalid_grant") {
    return {
      status: "saved",
      message: `Credenciales OAuth verificadas. Falta el Refresh Token (scope adwords) para leer la cuenta ${customerId}; el Developer Token no se pudo validar todavía.`,
    };
  }
  if (error === "invalid_client" || error === "unauthorized_client" || response.status === 401) {
    return { status: "error", message: "El Client ID o el Client Secret no son válidos (Google respondió invalid_client)." };
  }
  return {
    status: "error",
    message: `Google rechazó las credenciales: ${error || `HTTP ${response.status}`}`,
  };
}

/* ─── GA4 ─── */

export async function testGa4ConnectionState(creds: {
  propertyId: string;
  serviceAccountJson: string;
}): Promise<ConnectionTest> {
  if (!parseGa4Credentials(creds)) {
    return { status: "missing", message: "Falta el Property ID o el JSON de la service account." };
  }
  const result = await testGa4Connection(creds);
  return { status: result.ok ? "connected" : "error", message: result.message };
}
