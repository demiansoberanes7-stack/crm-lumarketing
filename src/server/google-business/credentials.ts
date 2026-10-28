import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

/**
 * Credenciales OAuth de Google Business Profile (scope `business.manage`).
 * Mismo patrón que agenda/connectors/google-credentials: el dueño pega
 * clientId, clientSecret y refreshToken una sola vez; los secretos viven
 * cifrados (AES-256-GCM).
 */

export type GoogleBusinessCreds = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  status: "connected" | "error";
  lastSyncedAt: Date | null;
};

export async function getGoogleBusinessCredentials(
  organizationId: string
): Promise<GoogleBusinessCreds | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.googleBusinessCredentials)
    .where(scoped(schema.googleBusinessCredentials.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
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
      status: row.status as "connected" | "error",
      lastSyncedAt: row.lastSyncedAt,
    };
  } catch {
    // Cifrado que no abre = sin conexion; el resto de conectores ya hace esto.
    return null;
  }
}

export async function saveGoogleBusinessCredentials(input: {
  organizationId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
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
    status: "connected",
    updatedAt: new Date(),
  };
  const existing = await getGoogleBusinessCredentials(input.organizationId);
  if (existing) {
    await db
      .update(schema.googleBusinessCredentials)
      .set(values)
      .where(scoped(schema.googleBusinessCredentials.organizationId, input.organizationId));
  } else {
    await db.insert(schema.googleBusinessCredentials).values({
      id: newId("googleBusinessCredentials"),
      organizationId: input.organizationId,
      ...values,
    });
  }
}

export async function deleteGoogleBusinessCredentials(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.googleBusinessCredentials)
    .where(scoped(schema.googleBusinessCredentials.organizationId, organizationId));
}

export async function markGoogleBusinessSynced(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.googleBusinessCredentials)
    .set({ lastSyncedAt: new Date(), status: "connected", updatedAt: new Date() })
    .where(scoped(schema.googleBusinessCredentials.organizationId, organizationId));
}

export async function markGoogleBusinessError(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.googleBusinessCredentials)
    .set({ status: "error", updatedAt: new Date() })
    .where(scoped(schema.googleBusinessCredentials.organizationId, organizationId));
}
