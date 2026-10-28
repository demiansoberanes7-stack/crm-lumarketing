import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

/**
 * Credenciales OAuth de Mercado Libre (scope de mensajería post-venta).
 * Mismo patrón que google-business/credentials: el dueño pega clientId,
 * clientSecret y refreshToken una sola vez; los secretos viven cifrados
 * (AES-256-GCM). El access token de corta vida se guarda y refresca en el
 * poller cuando expira.
 */

export type MarketplaceCreds = {
  userId: string | null;
  siteId: string | null;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
  status: "connected" | "reconnect_required" | "error";
  lastPolledAt: Date | null;
};

export async function getMarketplaceCredentials(
  organizationId: string
): Promise<MarketplaceCreds | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.marketplaceCredentials)
    .where(scoped(schema.marketplaceCredentials.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    return {
      userId: row.userId,
      siteId: row.siteId,
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
      accessToken: row.accessTokenCipher
        ? decryptSecret({
            cipher: row.accessTokenCipher,
            iv: row.accessTokenIv ?? "",
            tag: row.accessTokenTag ?? "",
          })
        : null,
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      status: row.status as MarketplaceCreds["status"],
      lastPolledAt: row.lastPolledAt,
    };
  } catch {
    // Cifrado que no abre = sin conexion; el resto de conectores ya hace esto.
    return null;
  }
}

export async function saveMarketplaceCredentials(input: {
  organizationId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userId?: string | null;
  siteId?: string | null;
}): Promise<void> {
  const db = getDb();
  const clientSecretEnc = encryptSecret(input.clientSecret);
  const refreshTokenEnc = encryptSecret(input.refreshToken);
  const values = {
    clientId: input.clientId,
    clientSecretCipher: clientSecretEnc.cipher,
    clientSecretIv: clientSecretEnc.iv,
    clientSecretTag: clientSecretEnc.tag,
    refreshTokenCipher: refreshTokenEnc.cipher,
    refreshTokenIv: refreshTokenEnc.iv,
    refreshTokenTag: refreshTokenEnc.tag,
    ...(input.userId != null ? { userId: input.userId } : {}),
    ...(input.siteId != null ? { siteId: input.siteId } : {}),
    status: "connected",
    updatedAt: new Date(),
  };
  const existing = await getMarketplaceCredentials(input.organizationId);
  if (existing) {
    await db
      .update(schema.marketplaceCredentials)
      .set(values)
      .where(scoped(schema.marketplaceCredentials.organizationId, input.organizationId));
  } else {
    await db.insert(schema.marketplaceCredentials).values({
      id: newId("marketplaceCredentials"),
      organizationId: input.organizationId,
      ...values,
    });
  }
}

export async function deleteMarketplaceCredentials(organizationId: string): Promise<void> {
  await getDb()
    .delete(schema.marketplaceCredentials)
    .where(scoped(schema.marketplaceCredentials.organizationId, organizationId));
}

/**
 * Guarda el access token refrescado (cifrado) y su expiración. Se llama en el
 * flujo de refresh del poller y en el guard de envío.
 */
export async function saveMarketplaceAccessToken(
  organizationId: string,
  accessToken: string,
  expiresInSeconds: number
): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(accessToken);
  await db
    .update(schema.marketplaceCredentials)
    .set({
      accessTokenCipher: enc.cipher,
      accessTokenIv: enc.iv,
      accessTokenTag: enc.tag,
      accessTokenExpiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      status: "connected",
      updatedAt: new Date(),
    })
    .where(scoped(schema.marketplaceCredentials.organizationId, organizationId));
}

/** Guarda el refresh token rotado por Mercado Libre (si la API devuelve uno nuevo). */
export async function saveMarketplaceRefreshToken(
  organizationId: string,
  refreshToken: string
): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(refreshToken);
  await db
    .update(schema.marketplaceCredentials)
    .set({
      refreshTokenCipher: enc.cipher,
      refreshTokenIv: enc.iv,
      refreshTokenTag: enc.tag,
      updatedAt: new Date(),
    })
    .where(scoped(schema.marketplaceCredentials.organizationId, organizationId));
}

export async function markMarketplacePolled(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.marketplaceCredentials)
    .set({ lastPolledAt: new Date(), updatedAt: new Date() })
    .where(scoped(schema.marketplaceCredentials.organizationId, organizationId));
}

export async function markMarketplaceReconnectRequired(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.marketplaceCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.marketplaceCredentials.organizationId, organizationId));
}

export async function markMarketplaceError(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.marketplaceCredentials)
    .set({ status: "error", updatedAt: new Date() })
    .where(scoped(schema.marketplaceCredentials.organizationId, organizationId));
}
