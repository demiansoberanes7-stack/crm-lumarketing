import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

/**
 * Credenciales del módulo de inteligencia: SerpApi, Apify, INEGI-DENUE y
 * YouTube (opcional). Cada proveedor se guarda y prueba de forma independiente:
 * no se exige YouTube para configurar SerpApi, Apify ni INEGI.
 *
 * Secretos cifrados AES-256-GCM (triple cipher/iv/tag). Cada fuente tiene
 * estado de prueba en vivo ("ok"/"error") y timestamp para el badge
 * verde/rojo en la UI.
 */

export type SourceKey = "youtube" | "denue" | "serpapi" | "apify" | "gt";

export type IntelCreds = {
  youtubeKey: string | null;
  denueToken: string | null;
  serpapiKey: string | null;
  apifyToken: string | null;
  apifyActorId: string | null;
  lastIngestAt: Date | null;
  status: "connected" | "error";
  // Estado de pruebas por fuente
  youtubeStatus: "ok" | "error" | null;
  youtubeLastTestAt: Date | null;
  denueStatus: "ok" | "error" | null;
  denueLastTestAt: Date | null;
  serpapiStatus: "ok" | "error" | null;
  serpapiLastTestAt: Date | null;
  serpapiLastSyncAt: Date | null;
  serpapiQueriesUsed: number;
  apifyStatus: "ok" | "error" | null;
  apifyLastTestAt: Date | null;
  apifyLastSyncAt: Date | null;
  apifyQueriesUsed: number;
  gtEnabled: boolean;
  gtStatus: "ok" | "error" | null;
  gtLastTestAt: Date | null;
  gtLastSyncAt: Date | null;
};

function decryptOrNull(
  cipher: string | null,
  iv: string | null,
  tag: string | null
): string | null {
  if (!cipher || !iv || !tag) return null;
  try {
    return decryptSecret({ cipher, iv, tag });
  } catch {
    return null;
  }
}

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
  return {
    youtubeKey: decryptOrNull(row.youtubeKeyCipher, row.youtubeKeyIv, row.youtubeKeyTag),
    denueToken: decryptOrNull(row.denueTokenCipher, row.denueTokenIv, row.denueTokenTag),
    serpapiKey: decryptOrNull(row.serpapiKeyCipher, row.serpapiKeyIv, row.serpapiKeyTag),
    apifyToken: decryptOrNull(row.apifyTokenCipher, row.apifyTokenIv, row.apifyTokenTag),
    apifyActorId: row.apifyActorId,
    lastIngestAt: row.lastIngestAt,
    status: row.status as "connected" | "error",
    youtubeStatus: (row.youtubeStatus as "ok" | "error" | null) ?? null,
    youtubeLastTestAt: row.youtubeLastTestAt,
    denueStatus: (row.denueStatus as "ok" | "error" | null) ?? null,
    denueLastTestAt: row.denueLastTestAt,
    serpapiStatus: (row.serpapiStatus as "ok" | "error" | null) ?? null,
    serpapiLastTestAt: row.serpapiLastTestAt,
    serpapiLastSyncAt: row.serpapiLastSyncAt,
    serpapiQueriesUsed: row.serpapiQueriesUsed ?? 0,
    apifyStatus: (row.apifyStatus as "ok" | "error" | null) ?? null,
    apifyLastTestAt: row.apifyLastTestAt,
    apifyLastSyncAt: row.apifyLastSyncAt,
    apifyQueriesUsed: row.apifyQueriesUsed ?? 0,
    gtEnabled: row.gtEnabled ?? false,
    gtStatus: (row.gtStatus as "ok" | "error" | null) ?? null,
    gtLastTestAt: row.gtLastTestAt,
    gtLastSyncAt: row.gtLastSyncAt,
  };
}

/**
 * Guarda/actualiza las credenciales. Cada campo es opcional: si no llega
 * se conserva el valor existente (o null si no había). Esto permite
 * actualizaciones parciales desde cada tarjeta de configuración.
 */
export async function saveIntelCredentials(input: {
  organizationId: string;
  youtubeKey?: string | null;
  denueToken?: string | null;
  serpapiKey?: string | null;
  apifyToken?: string | null;
  apifyActorId?: string | null;
  gtEnabled?: boolean;
}): Promise<void> {
  const db = getDb();
  const existing = await getIntelCredentials(input.organizationId);

  const values: Record<string, unknown> = { updatedAt: new Date() };

  // YouTube (solo si llega key nueva)
  if (input.youtubeKey !== undefined) {
    if (input.youtubeKey) {
      const enc = encryptSecret(input.youtubeKey);
      values.youtubeKeyCipher = enc.cipher;
      values.youtubeKeyIv = enc.iv;
      values.youtubeKeyTag = enc.tag;
    } else {
      values.youtubeKeyCipher = null;
      values.youtubeKeyIv = null;
      values.youtubeKeyTag = null;
    }
  }

  // DENUE
  if (input.denueToken !== undefined) {
    if (input.denueToken) {
      const enc = encryptSecret(input.denueToken);
      values.denueTokenCipher = enc.cipher;
      values.denueTokenIv = enc.iv;
      values.denueTokenTag = enc.tag;
    } else {
      values.denueTokenCipher = null;
      values.denueTokenIv = null;
      values.denueTokenTag = null;
    }
  }

  // SerpApi
  if (input.serpapiKey !== undefined) {
    if (input.serpapiKey) {
      const enc = encryptSecret(input.serpapiKey);
      values.serpapiKeyCipher = enc.cipher;
      values.serpapiKeyIv = enc.iv;
      values.serpapiKeyTag = enc.tag;
    } else {
      values.serpapiKeyCipher = null;
      values.serpapiKeyIv = null;
      values.serpapiKeyTag = null;
    }
  }

  // Apify
  if (input.apifyToken !== undefined) {
    if (input.apifyToken) {
      const enc = encryptSecret(input.apifyToken);
      values.apifyTokenCipher = enc.cipher;
      values.apifyTokenIv = enc.iv;
      values.apifyTokenTag = enc.tag;
    } else {
      values.apifyTokenCipher = null;
      values.apifyTokenIv = null;
      values.apifyTokenTag = null;
    }
  }
  if (input.apifyActorId !== undefined) {
    values.apifyActorId = input.apifyActorId || null;
  }

  // Google Trends checkbox
  if (input.gtEnabled !== undefined) {
    values.gtEnabled = input.gtEnabled;
  }

  if (existing) {
    await db
      .update(schema.intelCredentials)
      .set(values)
      .where(scoped(schema.intelCredentials.organizationId, input.organizationId));
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
  source: SourceKey,
  ok: boolean
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const field: Record<string, unknown> = {};
  switch (source) {
    case "youtube":
      field.youtubeStatus = ok ? "ok" : "error";
      field.youtubeLastTestAt = now;
      break;
    case "denue":
      field.denueStatus = ok ? "ok" : "error";
      field.denueLastTestAt = now;
      break;
    case "serpapi":
      field.serpapiStatus = ok ? "ok" : "error";
      field.serpapiLastTestAt = now;
      break;
    case "apify":
      field.apifyStatus = ok ? "ok" : "error";
      field.apifyLastTestAt = now;
      break;
    case "gt":
      field.gtStatus = ok ? "ok" : "error";
      field.gtLastTestAt = now;
      break;
  }
  field.updatedAt = now;
  await db
    .update(schema.intelCredentials)
    .set(field)
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}

/** Marca la última sincronización exitosa de SerpApi. */
export async function markSerpApiSynced(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.intelCredentials)
    .set({ serpapiLastSyncAt: new Date(), updatedAt: new Date() })
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}

/** Marca la última sincronización exitosa de Apify. */
export async function markApifySynced(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.intelCredentials)
    .set({ apifyLastSyncAt: new Date(), updatedAt: new Date() })
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}

/** Marca la última sincronización GT exitosa (legacy, misma columna). */
export async function markGtSynced(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.intelCredentials)
    .set({ gtLastSyncAt: new Date(), updatedAt: new Date() })
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}

/** Incrementa el contador de consultas del mes para SerpApi. */
export async function incrementSerpApiUsage(organizationId: string): Promise<void> {
  const creds = await getIntelCredentials(organizationId);
  const used = (creds?.serpapiQueriesUsed ?? 0) + 1;
  await getDb()
    .update(schema.intelCredentials)
    .set({ serpapiQueriesUsed: used, updatedAt: new Date() })
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}

/** Incrementa el contador de consultas del mes para Apify. */
export async function incrementApifyUsage(organizationId: string): Promise<void> {
  const creds = await getIntelCredentials(organizationId);
  const used = (creds?.apifyQueriesUsed ?? 0) + 1;
  await getDb()
    .update(schema.intelCredentials)
    .set({ apifyQueriesUsed: used, updatedAt: new Date() })
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}

export async function deleteIntelCredentials(
  organizationId: string
): Promise<void> {
  await getDb()
    .delete(schema.intelCredentials)
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}

export async function markIntelIngested(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.intelCredentials)
    .set({ lastIngestAt: new Date(), status: "connected", updatedAt: new Date() })
    .where(scoped(schema.intelCredentials.organizationId, organizationId));
}
