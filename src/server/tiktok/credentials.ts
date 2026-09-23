import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * Credenciales del canal de TikTok.
 *
 * Solo Zernio por ahora: TikTok DMs solo se pueden recibir a través de
 * APIs intermediarias (Zernio). El token viaja descifrado solo en memoria.
 */

export type TikTokCredentials = {
  id: string;
  organizationId: string;
  source: "zernio";
  tiktokUserId: string | null;
  username: string | null;
  accountRef: string | null;
  webhookSecret: string | null;
  status: "connected" | "reconnect_required";
  token: string;
};

type Row = typeof schema.tiktokCredentials.$inferSelect;

function toCredentials(row: Row): TikTokCredentials | null {
  try {
    return {
      id: row.id,
      organizationId: row.organizationId,
      source: row.source as "zernio",
      tiktokUserId: row.tiktokUserId,
      username: row.username,
      accountRef: row.accountRef,
      webhookSecret: row.webhookSecret,
      status: row.status as "connected" | "reconnect_required",
      token: decryptSecret({
        cipher: row.tokenCipher,
        iv: row.tokenIv,
        tag: row.tokenTag,
      }),
    };
  } catch {
    return null;
  }
}

export async function getTikTokCredentialsByOrg(
  organizationId: string
): Promise<TikTokCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.tiktokCredentials)
    .where(eq(schema.tiktokCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutado del webhook de Zernio: el evento trae `account.id`. */
export async function getTikTokCredentialsByAccountRef(
  accountRef: string
): Promise<TikTokCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.tiktokCredentials)
    .where(eq(schema.tiktokCredentials.accountRef, accountRef))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function saveTikTokCredentials(input: {
  organizationId: string;
  tiktokUserId: string | null;
  username: string | null;
  accountRef: string | null;
  token: string;
  webhookSecret: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.token);
  const existing = await getTikTokCredentialsByOrg(input.organizationId);

  const values = {
    organizationId: input.organizationId,
    source: "zernio" as const,
    tiktokUserId: input.tiktokUserId,
    username: input.username,
    accountRef: input.accountRef,
    tokenCipher: enc.cipher,
    tokenIv: enc.iv,
    tokenTag: enc.tag,
    webhookSecret: input.webhookSecret,
    status: "connected" as const,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(schema.tiktokCredentials)
      .set(values)
      .where(eq(schema.tiktokCredentials.id, existing.id));
    return;
  }
  await db
    .insert(schema.tiktokCredentials)
    .values({ id: newId("credentials"), ...values });
}

/** El token murió: se pausan los envíos y la UI pide reconectar. */
export async function markTikTokReconnectRequired(
  organizationId: string
): Promise<void> {
  await getDb()
    .update(schema.tiktokCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(eq(schema.tiktokCredentials.organizationId, organizationId));
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}
