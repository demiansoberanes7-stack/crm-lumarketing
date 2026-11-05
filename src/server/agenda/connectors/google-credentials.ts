import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

/**
 * 015 — Credenciales de la app de Google Cloud del propio negocio.
 *
 * DOS secretos cifrados: el client secret y el refresh token que el dueño pega
 * una sola vez. Mismo mecanismo AES-256-GCM que el resto.
 *
 * Desde 0087 hay DOS CLASES de fila en la misma tabla, y la diferencia no es
 * cosmética: `user_id IS NULL` es EL CALENDARIO DEL NEGOCIO —el único que puede
 * crear citas con Meet— y `user_id = alguien` es el calendario personal de esa
 * persona, que solo sirve para sus tareas. Por eso este módulo no expone un
 * lector genérico con un `userId` opcional: expone los dos nombres que dicen
 * cuál buscan. Un parámetro que se puede olvidar omitir es exactamente el bug
 * que estaba aquí (`.limit(1)` sin filtro: el conector de citas podía atarse al
 * calendario de un miembro).
 */

export type GoogleCreds = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
  status: "connected" | "error";
  /**
   * Apagado por defecto: sincronizar Pendientes/tareas es opt-in de quien
   * conecta el calendario. Opcional en el tipo porque el conector de citas no lo
   * usa.
   */
  syncTasks?: boolean;
};

type Row = typeof schema.googleCredentials.$inferSelect;

function ownerIs(userId: string | null) {
  return userId ? eq(schema.googleCredentials.userId, userId) : isNull(schema.googleCredentials.userId);
}

function selectOwner(organizationId: string, userId: string | null) {
  return getDb()
    .select()
    .from(schema.googleCredentials)
    .where(and(scoped(schema.googleCredentials.organizationId, organizationId), ownerIs(userId)))
    .limit(1);
}

/**
 * `null` también cuando el cifrado no abre (llave rotada, fila restaurada desde
 * otra instancia): se trata como "sin conexión" y la dueña vuelve a conectar,
 * en vez de tumbar el calendario o Ajustes. Mismo criterio que el resto.
 */
function open(row: Row | undefined): GoogleCreds | null {
  if (!row) return null;
  try {
    return {
      clientId: row.clientId,
      clientSecret: decryptSecret({
        cipher: row.clientSecretCipher,
        iv: row.clientSecretIv,
        tag: row.clientSecretTag,
      }),
      refreshToken: decryptSecret({
        cipher: row.refreshTokenCipher,
        iv: row.refreshTokenIv,
        tag: row.refreshTokenTag,
      }),
      calendarId: row.calendarId,
      status: row.status as "connected" | "error",
      syncTasks: row.syncTasks ?? false,
    };
  } catch {
    return null;
  }
}

async function read(organizationId: string, userId: string | null): Promise<GoogleCreds | null> {
  const rows = await selectOwner(organizationId, userId);
  return open(rows[0]);
}

/**
 * La fila del negocio. La usan los conectores (enlaces de Meet), las citas y el
 * estado de conexiones. Ningún flujo de agenda se resuelve con otra función.
 */
export async function getBusinessGoogleCredentials(
  organizationId: string
): Promise<GoogleCreds | null> {
  return read(organizationId, null);
}

/**
 * La fila de la persona, con la cascada de D2: si no conectó su calendario,
 * sigue valiendo el del negocio. Igual que `getSettings`, nadie cambia de
 * comportamiento hasta que configura el suyo.
 */
export async function getPersonalGoogleCredentials(
  organizationId: string,
  userId: string | null
): Promise<GoogleCreds | null> {
  if (userId) {
    const own = await read(organizationId, userId);
    if (own) return own;
  }
  return read(organizationId, null);
}

/**
 * La fila EXACTA, sin cascada. La necesita Ajustes para decir «todavía no has
 * conectado el tuyo» en vez de mostrar el estado del negocio como si fuera el
 * de la persona.
 */
export async function peekGoogleCredentials(
  organizationId: string,
  userId: string | null
): Promise<GoogleCreds | null> {
  return read(organizationId, userId);
}

export async function saveGoogleCredentials(input: {
  organizationId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId?: string | null;
  /** `null`/ausente = la fila del negocio. */
  userId?: string | null;
  syncTasks?: boolean;
}): Promise<void> {
  const db = getDb();
  const secret = encryptSecret(input.clientSecret);
  const refresh = encryptSecret(input.refreshToken);
  const values = {
    clientId: input.clientId,
    clientSecretCipher: secret.cipher,
    clientSecretIv: secret.iv,
    clientSecretTag: secret.tag,
    refreshTokenCipher: refresh.cipher,
    refreshTokenIv: refresh.iv,
    refreshTokenTag: refresh.tag,
    calendarId: input.calendarId?.trim() || "primary",
    status: "connected" as const,
    ...(input.syncTasks === undefined ? {} : { syncTasks: input.syncTasks }),
  };
  await db
    .insert(schema.googleCredentials)
    .values({
      id: newId("googleCredentials"),
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      ...values,
    })
    .onConflictDoUpdate({
      // Tras 0087 la unique es (organization_id, user_id): el `DROP INDEX
      // google_credentials_org_uq` de la misma migración deja sin candidato al
      // target de una columna, y Postgres responde 42P10 — es decir, NADIE
      // podría conectar Google. Las dos columnas van siempre.
      target: [schema.googleCredentials.organizationId, schema.googleCredentials.userId],
      set: { ...values, updatedAt: new Date() },
    });
  clearGoogleTokenCache();
}

/**
 * `POST https://oauth2.googleapis.com/revoke` con el refresh token de ESA fila.
 *
 * Sin esto, "desconectar" era local: Google seguía autorizando el token y la
 * app del CRM conservaba acceso al calendario de una persona que ya se fue.
 * Best-effort con criterio: si Google no responde (corte, 5xx) se borra la fila
 * igual y se deja el motivo en el log — dejar credenciales que ya no podemos
 * usar pero que sí puede usar Google es peor. Un 4xx significa que el token ya
 * no vale: es el estado que buscábamos, no un fallo.
 */
async function revokeInGoogle(creds: GoogleCreds): Promise<void> {
  const body = new URLSearchParams({
    token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  try {
    const res = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      // La desconexión no puede quedarse colgada de Google.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok && res.status < 500) return; // ya estaba revocado
    if (!res.ok) throw new Error(`Google respondió ${res.status}`);
  } catch (err) {
    console.warn(`[google] no se pudo revocar el token en Google: ${err}`);
  }
}

/** Desconecta UNA fila: la del negocio o la de una persona, nunca las dos. */
export async function deleteGoogleCredentials(
  organizationId: string,
  userId: string | null = null
): Promise<void> {
  const creds = await read(organizationId, userId);
  if (creds) await revokeInGoogle(creds);
  const db = getDb();
  await db
    .delete(schema.googleCredentials)
    .where(and(scoped(schema.googleCredentials.organizationId, organizationId), ownerIs(userId)));
  clearGoogleTokenCache();
}

/** El estado `error` se escribe de verdad (ver zoom-credentials). */
export async function markGoogleError(
  organizationId: string,
  userId: string | null = null
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.googleCredentials)
    .set({ status: "error", updatedAt: new Date() })
    .where(and(scoped(schema.googleCredentials.organizationId, organizationId), ownerIs(userId)));
}

export function secretLast4(secret: string): string {
  return secret.slice(-4);
}

/** Enciende o apaga la sincronización de Pendientes y tareas de proyecto. */
export async function setGoogleTasksSync(
  organizationId: string,
  syncTasks: boolean,
  userId: string | null = null
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.googleCredentials)
    .set({ syncTasks, updatedAt: new Date() })
    .where(and(scoped(schema.googleCredentials.organizationId, organizationId), ownerIs(userId)));
}

/**
 * Quién tiene un calendario conectado, para el poller.
 *
 * Van las DOS clases de fila: la del negocio (Sus citas) y la de cada persona
 * (sus tareas). Filtrar solo `status = connected` es lo que evita que el barrido
 * le robe el token a una credencial ya marcada como rota — eso es trabajo de que
 * el dueño la reconecte, no de reintentarla cada cinco minutos.
 */
export async function listGoogleCalendars(): Promise<
  { organizationId: string; userId: string | null; syncTasks: boolean }[]
> {
  const rows = await getDb()
    .select({
      organizationId: schema.googleCredentials.organizationId,
      userId: schema.googleCredentials.userId,
      syncTasks: schema.googleCredentials.syncTasks,
    })
    .from(schema.googleCredentials)
    .where(eq(schema.googleCredentials.status, "connected"));
  return rows.map((r) => ({
    organizationId: r.organizationId,
    userId: r.userId,
    syncTasks: r.syncTasks,
  }));
}

/* Caché del access token, por proceso. Google los emite de una hora. */

type CachedToken = { token: string; expiresAtMs: number };

const globalForGoogle = globalThis as unknown as {
  __googleTokens?: Map<string, CachedToken>;
};

function tokenCache(): Map<string, CachedToken> {
  if (!globalForGoogle.__googleTokens) globalForGoogle.__googleTokens = new Map();
  return globalForGoogle.__googleTokens;
}

export function getCachedGoogleToken(key: string): string | null {
  const hit = tokenCache().get(key);
  if (!hit) return null;
  if (hit.expiresAtMs <= Date.now()) {
    tokenCache().delete(key);
    return null;
  }
  return hit.token;
}

export function setCachedGoogleToken(
  key: string,
  token: string,
  expiresInSeconds: number
): void {
  const ttl = Math.max(30, expiresInSeconds - 60) * 1000;
  tokenCache().set(key, { token, expiresAtMs: Date.now() + ttl });
}

export function clearGoogleTokenCache(): void {
  tokenCache().clear();
}
