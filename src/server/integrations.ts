import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export type IntegrationProvider =
  | "google_ads"
  | "meta_ads"
  | "ga4"
  /** Reglas del motor de automatizaciones (reglas editables desde la UI). */
  | "automation_rules";

export interface Integration {
  id: string;
  organizationId: string;
  provider: IntegrationProvider;
  credentials: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Las credenciales de integraciones (tokens de Meta Ads, developer token de
 * Google Ads, JSON de la service account de GA4) se guardan cifradas con
 * AES-256-GCM en un triple cipher/iv/tag (mismo patrón que 0007). El jsonb
 * legado se conserva como fallback de lectura: filas escritas antes de 0044
 * se descifran al vuelo y se re-cifran en la siguiente escritura.
 */
type IntegrationRow = typeof schema.integration.$inferSelect;

function rowToIntegration(row: IntegrationRow): Integration {
  let credentials: Record<string, unknown>;
  if (row.credentialsCipher && row.credentialsIv && row.credentialsTag) {
    // Una fila no descifrable (llave de cifrado rotada, cipher corrupto) no
    // debe tumbar el GET/POST de integraciones ni a las reglas de
    // automatización: se trata como "sin credenciales" y el dueño vuelve a
    // guardarlas. Mismo criterio que whatsapp/credentials.ts.
    try {
      credentials = JSON.parse(decryptSecret({
        cipher: row.credentialsCipher,
        iv: row.credentialsIv,
        tag: row.credentialsTag,
      })) as Record<string, unknown>;
    } catch {
      credentials = {};
    }
  } else {
    credentials = (row.credentials ?? {}) as Record<string, unknown>;
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    provider: row.provider as IntegrationProvider,
    credentials,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getIntegrations(organizationId: string): Promise<Integration[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.integration)
    .where(eq(schema.integration.organizationId, organizationId));
  return rows.map(rowToIntegration);
}

export async function getIntegration(
  organizationId: string,
  provider: IntegrationProvider
): Promise<Integration | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, organizationId),
        eq(schema.integration.provider, provider)
      )
    )
    .limit(1);
  const row = rows[0];
  return row ? rowToIntegration(row) : null;
}

export async function saveIntegration(
  organizationId: string,
  provider: IntegrationProvider,
  credentials: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  const encrypted = encryptSecret(JSON.stringify(credentials));
  const values = {
    credentials: {},
    credentialsCipher: encrypted.cipher,
    credentialsIv: encrypted.iv,
    credentialsTag: encrypted.tag,
    updatedAt: new Date(),
  };
  const existing = await getIntegration(organizationId, provider);
  if (existing) {
    await db
      .update(schema.integration)
      .set(values)
      .where(eq(schema.integration.id, existing.id));
  } else {
    await db.insert(schema.integration).values({
      id: newId("integration"),
      organizationId,
      provider,
      ...values,
    });
  }
}

export async function deleteIntegration(
  organizationId: string,
  provider: IntegrationProvider
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, organizationId),
        eq(schema.integration.provider, provider)
      )
    );
}
