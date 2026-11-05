/**
 * 015 · B2 — El resultado del vuelco de Google, explicado.
 *
 * Google redirige al navegador a `/settings/google?connected=1` o
 * `?error=<motivo>` y, desde el callback, también con `scope=personal`. Este
 * módulo es el único que traduce esos parámetros a una frase: vivía dentro del
 * componente de credenciales, pero el resultado ahora lo lee la página (un
 * servidor) y lo necesita también cuando la conexión la inició un miembro desde
 * su tarjeta personal —donde el componente de credenciales ni se renderiza.
 *
 * Se lee ANTES de consumir el `state`, así que hay fallos que jamás llegan a
 * saber de qué calendario iban: esos se explican sin alcance, no se inventan.
 */

export type GoogleOAuthScope = "business" | "personal";

/** Motivos de vuelta del callback → lo que le hace falta entender a quien conecta. */
const OAUTH_ERRORS: Record<string, string> = {
  state_invalid:
    "El enlace de conexión caducó o ya se usó. Vuelve a iniciar la conexión.",
  missing_code: "Google no devolvió el código de autorización.",
  exchange_failed: "No se pudo canjear el código por una credencial.",
  access_denied: "Cancelaste la autorización en Google.",
  invalid_client: "El Client ID o el Client Secret no son válidos.",
  invalid_grant: "El código caducó o la app sigue en modo prueba; repite la conexión.",
  redirect_uri_mismatch:
    "La URI de redirección no coincide con la registrada en Google Cloud.",
};

const SUBJECT: Record<GoogleOAuthScope, string> = {
  business: "Google Calendar del negocio",
  personal: "Tu calendario personal",
};

export type GoogleOAuthParams = {
  connected?: string | null;
  error?: string | null;
  scope?: string | null;
};

/**
 * La frase para el banner de la página, o `null` cuando la URL no trae
 * resultado (el caso normal: entrar a Ajustes sin volver de Google).
 */
export function googleOAuthMessage(
  params: GoogleOAuthParams
): { kind: "ok" | "error"; text: string } | null {
  const scope: GoogleOAuthScope = params.scope === "personal" ? "personal" : "business";
  if (params.connected) return { kind: "ok", text: `${SUBJECT[scope]} conectado` };
  const error = params.error;
  if (!error) return null;
  // Los motivos que Google devuelve en la propia URL (`error_description`) y los
  // que arma el intercambio ya son frases legibles: si no están en la tabla, se
  // muestran tal cual en vez de disimularlas detrás de un "error desconocido".
  return {
    kind: "error",
    text: `No se pudo conectar ${SUBJECT[scope].toLowerCase()}: ${OAUTH_ERRORS[error] ?? error}`,
  };
}
