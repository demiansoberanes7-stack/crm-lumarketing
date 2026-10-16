import { getDb, schema } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";
import { getEnv, isAiConfigured } from "@/lib/env";
/**
 * Clave LLM compartida del agente (bandeja) y del copiloto: UNA sola clave por
 * organización, guardada cifrada (AES-256-GCM, triple cipher/iv/tag) en las
 * columnas `ai_token_*` de `agent_profile`. Misma semántica que las
 * credenciales INTEL: un token "····" o vacío en el body conserva el guardado,
 * y `null` lo borra para volver al respaldo de la variable de entorno.
 *
 * Prioridad de resolución (resolveAiConfig): la clave guardada desde
 * Configuración gana — es la acción explícita del dueño —; la variable de
 * entorno (`OPENROUTER_API_TOKEN`) queda como respaldo de despliegue.
 */

export type AiCredentialSummary = {
  configured: boolean;
  source: "db" | "env" | "none";
  last4: string | null;
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

async function readProfileTokenRow(organizationId: string) {
  const rows = await getDb()
    .select({
      aiTokenCipher: schema.agentProfile.aiTokenCipher,
      aiTokenIv: schema.agentProfile.aiTokenIv,
      aiTokenTag: schema.agentProfile.aiTokenTag,
    })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/** Clave guardada desde Configuración (descifrada) o `null`. */
export async function getAiDbToken(organizationId: string): Promise<string | null> {
  const row = await readProfileTokenRow(organizationId);
  if (!row) return null;
  return decryptOrNull(row.aiTokenCipher, row.aiTokenIv, row.aiTokenTag);
}

/**
 * Estado de la clave para la UI: `db` = guardada desde Configuración (tiene
 * prioridad), `env` = solo variable de entorno, `none` = sin clave.
 * El token completo jamás sale de aquí; solo su último fragmento.
 */
export async function getAiCredentialSummary(
  organizationId: string
): Promise<AiCredentialSummary> {
  const dbToken = await getAiDbToken(organizationId);
  if (dbToken) {
    return { configured: true, source: "db", last4: dbToken.slice(-4) };
  }
  if (isAiConfigured()) {
    const envToken = process.env.OPENROUTER_API_TOKEN?.trim();
    return { configured: true, source: "env", last4: envToken?.slice(-4) ?? null };
  }
  return { configured: false, source: "none", last4: null };
}

/** Guarda (cifrando) o reemplaza la clave de la organización. */
export async function saveAiToken(organizationId: string, token: string): Promise<boolean> {
  const existing = await readProfileTokenRow(organizationId);
  if (!existing) return false;
  const enc = encryptSecret(token.trim());
  await getDb()
    .update(schema.agentProfile)
    .set({
      aiTokenCipher: enc.cipher,
      aiTokenIv: enc.iv,
      aiTokenTag: enc.tag,
      // El campo plaintext heredado jamás se usa: se limpia por si acaso.
      aiToken: null,
      updatedAt: new Date(),
    })
    .where(scoped(schema.agentProfile.organizationId, organizationId));
  return true;
}

/** Borra la clave guardada: vuelve al respaldo de la variable de entorno. */
export async function clearAiToken(organizationId: string): Promise<boolean> {
  const existing = await readProfileTokenRow(organizationId);
  if (!existing) return false;
  await getDb()
    .update(schema.agentProfile)
    .set({
      aiTokenCipher: null,
      aiTokenIv: null,
      aiTokenTag: null,
      aiToken: null,
      updatedAt: new Date(),
    })
    .where(scoped(schema.agentProfile.organizationId, organizationId));
  return true;
}

/**
 * Prueba en vivo contra `GET {base}/v1/models` con la clave en el header
 * Authorization. Nunca lanza: devuelve `{ ok, reason }` para que la ruta
 * responda 422 con el motivo legible.
 */
export async function verifyAiToken(
  token: string
): Promise<{ ok: boolean; reason?: string }> {
  const baseUrl = getEnv().OPENROUTER_BASE_URL.replace(/\/+$/, "");
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: `El proveedor rechazó la clave (HTTP ${res.status}). Verifica que sea correcta.`,
      };
    }
    return { ok: false, reason: `El proveedor respondió HTTP ${res.status}.` };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "error de red";
    return { ok: false, reason: `No se pudo contactar al proveedor (${detail}).` };
  }
}
