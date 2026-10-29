import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { normalizeWebchatSettings, type WebchatSettings } from "@/lib/webchat";

/**
 * Persistencia del chat del sitio.
 *
 * El widget público recibe SOLO una llave (`wc_…`) y tiene que traducirla a
 * una organización sin sesión. Como la configuración vive en
 * `organization.metadata` (texto, sin índice), la traducción es un barrido de
 * organizaciones con caché corta: una instancia tiene una o unas pocas, y un
 * índice permanente se quedaría viejo en cuanto el dueño rota la llave.
 */

const KEY_CACHE_MS = 60_000;

let keyCache: { at: number; index: Map<string, string> } | null = null;

/** Solo para tests. */
export function resetWebchatKeyCache(): void {
  keyCache = null;
}

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function newWebchatKey(): string {
  return `wc_${randomBytes(12).toString("hex")}`;
}

/**
 * Devuelve la llave existente o genera una. La llave NO se regenera al
 * guardar: cambiarla en silencio rompería el snippet que el dueño ya pegó en
 * su sitio, y el widget dejaría de recibir mensajes sin que nadie tocara nada.
 */
export function ensureWebchatKey(settings: WebchatSettings): WebchatSettings {
  if (settings.publicKey) return settings;
  return { ...settings, publicKey: newWebchatKey() };
}

export async function getWebchatSettings(
  organizationId: string
): Promise<WebchatSettings> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  return normalizeWebchatSettings(meta.webchat);
}

export async function saveWebchatSettings(
  organizationId: string,
  settings: WebchatSettings
): Promise<WebchatSettings> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  const normalized = ensureWebchatKey(normalizeWebchatSettings(settings));
  meta.webchat = normalized;
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
  keyCache = null;
  return normalized;
}

async function webchatIndex(): Promise<Map<string, string>> {
  if (keyCache && Date.now() - keyCache.at < KEY_CACHE_MS) return keyCache.index;
  const rows = await getDb()
    .select({ id: schema.organization.id, metadata: schema.organization.metadata })
    .from(schema.organization);
  const index = new Map<string, string>();
  for (const row of rows) {
    const settings = normalizeWebchatSettings(
      parseMetadata(row.metadata).webchat
    );
    if (settings.publicKey) index.set(settings.publicKey, row.id);
  }
  keyCache = { at: Date.now(), index };
  return index;
}

/**
 * Organización dueña de una llave pública, o null. Fail-closed: una llave
 * desconocida no cae en «la primera organización» — con dos negocios eso
 * repartiría visitantes entre clientes.
 */
export async function findWebchatOrganization(
  publicKey: string
): Promise<{ organizationId: string; settings: WebchatSettings } | null> {
  const index = await webchatIndex();
  const organizationId = index.get(publicKey);
  if (!organizationId) return null;
  const settings = await getWebchatSettings(organizationId);
  if (settings.publicKey !== publicKey) return null;
  return { organizationId, settings };
}
