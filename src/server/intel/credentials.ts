import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

/**
 * API keys del módulo de inteligencia (YouTube Data API + token DENUE +
 * Google Trends opcional). Mismo patrón que google-business/credentials: el
 * owner pega las claves una sola vez; los secretos viven cifrados (AES-256-GCM)
 * y jamás viajan al cliente (solo los últimos 4).
 *
 * Además del cifrado, cada fuente tiene estado de prueba en vivo
 * (`youtubeStatus`, `denueStatus`, `gtStatus`): "ok" o "error" con timestamp.
 * Esto distingue «Guardado» (cifrado en BD) de «Conectado» (probado hoy).
 */

export type IntelCreds = {
  youtubeKey: string;
  denueToken: string | null;
  lastIngestAt: Date | null;
  status: "connected" | "error";
  // Estado de pruebas por fuente
  youtubeStatus: "ok" | "error" | null;
  youtubeLastTestAt: Date | null;
  denueStatus: "ok" | "error" | null;
  denueLastTestAt: Date | null;
  gtEnabled: boolean;
  gtStatus: "ok" | "error" | null;
  gtLastTestAt: Date | null;
  gtLastSyncAt: Date | null;
};

export async function getIntelCredentials(
  organizationId: string
): Promise<IntelCreds | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.intelCredentials)
    .where(scoped(schema.intelCredentials.organizationId, organizationId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  try {
    return {
      youtubeKey: decryptSecret({
        cipher: row.youtubeKeyCipher,
        iv: row.youtubeKeyIv,
        tag: row.youtubeKeyTag,
      }),
      denueToken:
        row.denueTokenCipher && row.denueTokenIv && row.denueTokenTag
          ? decryptSecret({
              cipher: row.denueTokenCipher,
              iv: row.denueTokenIv,
              tag: row.denueTokenTag,
            })
          : null,
      lastIngestAt: row.lastIngestAt,
      status: row.status as "connected" | "error",
      youtubeStatus: (row.youtubeStatus as "ok" | "error" | null) ?? null,
      youtubeLastTestAt: row.youtubeLastTestAt,
      denueStatus: (row.denueStatus as "ok" | "error" | null) ?? null,
      denueLastTestAt: row.denueLastTestAt,
      gtEnabled: row.gtEnabled ?? false,
      gtStatus: (row.gtStatus as "ok" | "error" | null) ?? null,
      gtLastTestAt: row.gtLastTestAt,
      gtLastSyncAt: row.gtLastSyncAt,
    };
  } catch {
    return null;
  }
}

export async function saveIntelCredentials(input: {
  organizationId: string;
  youtubeKey: string;
  denueToken?: string | null;
  gtEnabled?: boolean;
}): Promise<void> {
  const db = getDb();
  const youtubeEnc = encryptSecret(input.youtubeKey);
  const denueEnc = input.denueToken ? encryptSecret(input.denueToken) : null;
  const values = {
    youtubeKeyCipher: youtubeEnc.cipher,
    youtubeKeyIv: youtubeEnc.iv,
    youtubeKeyTag: youtubeEnc.tag,
    denueTokenCipher: denueEnc?.cipher ?? null,
    denueTokenIv: denueEnc?.iv ?? null,
    denueTokenTag: denueEnc?.tag ?? null,
    gtEnabled: input.gtEnabled ?? false,
    status: "connected",
    updatedAt: new Date(),
  };
  const existing = await getIntelCredentials(input.organizationId);
  if (existing) {
    await db
      .update(schema.intelCredentials)
      .set(values)
      .where(
        scoped(schema.intelCredentials.organizationId, input.organizationId)
      );
  } else {
    await db.insert(schema.intelCredentials).values({
      id: newId("intelCredentials"),
      organizationId: input.organizationId,
      ...values,
    });
  }
}

/** Guarda solo el resultado de una prueba en vivo de una fuente. */
export async function markSourceTestResult(
  organizationId: string,
  source: "youtube" | "denue" | "gt",
  ok: boolean
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const field =
    source === "youtube"
      ? { youtubeStatus: ok ? "ok" : "error", youtubeLastTestAt: now }
      : source === "denue"
        ? { denueStatus: ok ? "ok" : "error", denueLastTestAt: now }
        : { gtStatus: ok ? "ok" : "error", gtLastTestAt: now };
  await db
    .update(schema.intelCredentials)
    .set({ ...field, updatedAt: now })
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}

/** Marca la última sincronización GT exitosa. */
export async function markGtSynced(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.intelCredentials)
    .set({ gtLastSyncAt: new Date(), updatedAt: new Date() })
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}

export async function deleteIntelCredentials(
  organizationId: string
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.intelCredentials)
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}

export async function markIntelIngested(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.intelCredentials)
    .set({ lastIngestAt: new Date(), status: "connected", updatedAt: new Date() })
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}
