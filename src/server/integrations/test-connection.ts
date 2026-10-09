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
 * Verifica el par Client ID/Client Secret contra el endpoint de tokens.
 *
 * No se puede ir más lejos: leer la cuenta exige un access token que solo sale
 * del flujo OAuth con consentimiento del dueño, y ese flujo todavía no existe
 * en el producto. Por eso el resultado de una pareja válida es `saved` y nunca
 * `connected`.
 *
 * El truco está en el refresh token de mentira: con credenciales malas Google
 * devuelve `invalid_client`, y con credenciales buenas `invalid_grant` (el
 * refresh token —inexistente— es el que falla). Ese segundo caso es la
 * confirmación de que el par es bueno.
 */
export async function testGoogleAdsConnection(creds: {
  customerId: string;
  developerToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<ConnectionTest> {
  const { customerId, developerToken, clientId, clientSecret } = creds;
  if (!customerId.trim() || !developerToken.trim() || !clientId.trim() || !clientSecret.trim()) {
    return { status: "missing", message: "Faltan datos: completa Customer ID, Developer Token y las credenciales OAuth." };
  }
  if (!normalizeCustomerId(customerId)) {
    return { status: "error", message: "El Customer ID debe ser de 10 dígitos (123-456-7890)." };
  }

  const response = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId.trim(),
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
      message: `Credenciales OAuth verificadas. Falta el token de acceso (flujo OAuth) para leer la cuenta ${customerId}; el Developer Token no se pudo validar todavía.`,
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
