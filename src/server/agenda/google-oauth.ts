/**
 * Google Calendar — conexión con OAuth por redirect (callback).
 *
 * Antes el dueño tenía que conseguir el refresh token a mano (consent screen,
 * copiar, pegar). Aquí el CRM abre el consentimiento de Google y lo canjea por
 * él: el `state` de un solo uso (tabla `google_oauth_state`, 10 minutos) ata la
 * vuelta de Google a la organización que inició el flujo y lleva el client
 * secret cifrado que hace falta para el intercambio del `code`.
 *
 * Sin SDK: la constitución no admite dependencias nuevas para esto.
 */
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { GOOGLE_SCOPE } from "@/server/agenda/connectors/google";

/** Validez del `state`: tiempo suficiente para autorizar a mano, nada más. */
const STATE_TTL_MS = 10 * 60 * 1000;

export type GoogleOAuthPending = {
  clientId: string;
  clientSecret: string;
  calendarId: string;
};

function baseUrl(path: string): string {
  const base = getEnv().APP_BASE_URL.replace(/\/+$/, "");
  return `${base}${path}`;
}

/** URI de vuelta que debe coincidir EXACTAMENTE con la registrada en Google Cloud. */
export function googleOAuthRedirectUri(): string {
  return baseUrl("/api/settings/google/oauth/callback");
}

/** URL del consentimiento de Google (offline access → devuelve refresh token). */
export function googleConsentUrl(input: { clientId: string; state: string }): string {
  const url = new URL(`${getEnv().GOOGLE_OAUTH_BASE_URL}/o/oauth2/v2/auth`);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", googleOAuthRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  // `offline` + `consent` es la única forma de que Google entregue refresh token
  // siempre; sin `prompt=consent` no lo repite en sesiones siguientes.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}

/**
 * Abre un flujo: guarda el estado pendiente (client secret cifrado) y devuelve
 * la URL a la que mandar al navegador. Los estados vencidos de la organización
 * se podan en la misma pasada.
 */
export async function startGoogleOAuth(input: {
  organizationId: string;
  clientId: string;
  clientSecret: string;
  calendarId?: string | null;
}): Promise<string> {
  const db = getDb();
  await db
    .delete(schema.googleOauthState)
    .where(
      and(
        scoped(schema.googleOauthState.organizationId, input.organizationId),
        lt(schema.googleOauthState.expiresAt, new Date())
      )
    );

  const state = randomUUID();
  const secret = encryptSecret(input.clientSecret);
  await db.insert(schema.googleOauthState).values({
    id: newId("googleOauthState"),
    organizationId: input.organizationId,
    state,
    clientId: input.clientId,
    clientSecretCipher: secret.cipher,
    clientSecretIv: secret.iv,
    clientSecretTag: secret.tag,
    calendarId: input.calendarId?.trim() || "primary",
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  });

  return googleConsentUrl({ clientId: input.clientId, state });
}

/**
 * Canjea el `state` por las credenciales pendientes y lo consume (un solo
 * uso): estado ajeno, vencido o repetido ⇒ null. La organización se compara en
 * la query, no después: el `state` es un identificador opaco, no un secreto
 * que autorice por sí solo.
 */
export async function consumeGoogleOAuthState(
  organizationId: string,
  state: string
): Promise<GoogleOAuthPending | null> {
  if (!state) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.googleOauthState)
    .where(
      and(
        scoped(schema.googleOauthState.organizationId, organizationId),
        eq(schema.googleOauthState.state, state)
      )
    )
    .limit(1);
  if (!row) return null;

  // Un solo uso, pase lo que pase: se borra ANTES de canjear el código.
  await db.delete(schema.googleOauthState).where(eq(schema.googleOauthState.id, row.id));

  if (row.expiresAt.getTime() < Date.now()) return null;

  return {
    clientId: row.clientId,
    clientSecret: decryptSecret({
      cipher: row.clientSecretCipher,
      iv: row.clientSecretIv,
      tag: row.clientSecretTag,
    }),
    calendarId: row.calendarId,
  };
}

/** Error tipado del intercambio: la ruta lo traduce a un redirect legible. */
export class GoogleOAuthExchangeError extends Error {}

/** Canjea el `code` de Google por el refresh token. */
export async function exchangeGoogleAuthCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
}): Promise<{ refreshToken: string }> {
  let res: Response;
  try {
    res = await fetch(`${getEnv().GOOGLE_OAUTH_BASE_URL}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: googleOAuthRedirectUri(),
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch (err) {
    throw new GoogleOAuthExchangeError(`No se pudo contactar a Google: ${String(err)}`);
  }

  const data = (await res.json().catch(() => null)) as {
    refresh_token?: string;
    access_token?: string;
    error_description?: string;
    error?: string;
  } | null;

  if (!res.ok || !data?.access_token) {
    throw new GoogleOAuthExchangeError(
      data?.error_description ?? data?.error ?? `Google rechazó el código (${res.status})`
    );
  }
  if (!data.refresh_token) {
    // Google solo lo entrega la primera vez o con prompt=consent; sin él no
    // hay forma de renovar el access token una hora después.
    throw new GoogleOAuthExchangeError(
      "Google no devolvió refresh token. Publica la app y repite la conexión."
    );
  }
  return { refreshToken: data.refresh_token };
}

/** A dónde volver después del callback, con el resultado a la vista. */
export function googleOAuthReturnUrl(result: "ok" | string): string {
  return baseUrl(
    result === "ok" ? "/settings/google?connected=1" : `/settings/google?error=${encodeURIComponent(result)}`
  );
}
