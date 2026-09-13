/**
 * WAHA Credentials — CRUD de credenciales cifradas para WAHA.
 *
 * Las credenciales se almacenan cifradas con AES-256-GCM (mismo patrón que
 * meta/instagram/messenger credentials). La API key nunca se expone completa
 * al frontend: solo los últimos 4 caracteres.
 */

import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

export type WahaCredentials = {
  id: string;
  organizationId: string;
  baseUrl: string;
  sessionName: string;
  status: "connected" | "reconnect_required";
  apiKeyLast4: string;
};

type Row = typeof schema.wahaCredentials.$inferSelect;

function toCredentials(row: Row): WahaCredentials {
  const apiKey = decryptSecret({
    cipher: row.apiKeyCipher,
    iv: row.apiKeyIv,
    tag: row.apiKeyTag,
  });
  return {
    id: row.id,
    organizationId: row.organizationId,
    baseUrl: row.baseUrl,
    sessionName: row.sessionName,
    status: row.status as "connected" | "reconnect_required",
    apiKeyLast4: apiKey.slice(-4),
  };
}

export async function getWahaCredentialsByOrg(
  organizationId: string
): Promise<WahaCredentials | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.wahaCredentials)
    .where(scoped(schema.wahaCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Obtener credenciales completas (incluye API key) — solo uso interno. */
export async function getWahaCredentialsFull(
  organizationId: string
): Promise<{ baseUrl: string; apiKey: string; sessionName: string } | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.wahaCredentials)
    .where(scoped(schema.wahaCredentials.organizationId, organizationId))
    .limit(1);
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    baseUrl: row.baseUrl,
    apiKey: decryptSecret({
      cipher: row.apiKeyCipher,
      iv: row.apiKeyIv,
      tag: row.apiKeyTag,
    }),
    sessionName: row.sessionName,
  };
}

export async function saveWahaCredentials(input: {
  organizationId: string;
  baseUrl: string;
  apiKey: string;
  sessionName?: string;
}): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(input.apiKey);
  await db
    .insert(schema.wahaCredentials)
    .values({
      id: newId("wahaCredentials"),
      organizationId: input.organizationId,
      baseUrl: input.baseUrl,
      apiKeyCipher: enc.cipher,
      apiKeyIv: enc.iv,
      apiKeyTag: enc.tag,
      sessionName: input.sessionName ?? "default",
      status: "connected",
    })
    .onConflictDoUpdate({
      target: schema.wahaCredentials.organizationId,
      set: {
        baseUrl: input.baseUrl,
        apiKeyCipher: enc.cipher,
        apiKeyIv: enc.iv,
        apiKeyTag: enc.tag,
        sessionName: input.sessionName ?? "default",
        status: "connected",
        updatedAt: new Date(),
      },
    });
}

export async function markWahaReconnectRequired(
  organizationId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.wahaCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.wahaCredentials.organizationId, organizationId));
}
