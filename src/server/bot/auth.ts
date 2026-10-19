import { timingSafeEqual } from "node:crypto";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Autenticación de la API de servicio `/api/bot/*`.
 *
 * Esta superficie NO la consume el navegador: la consume un cerebro externo
 * (un microservicio propio del operador, en su mismo servidor) que quiere
 * conducir la conversación sin que el token de WhatsApp salga del CRM.
 * Header `X-API-Key` contra `BOT_API_KEY` (env), comparación en tiempo
 * constante. Sin `BOT_API_KEY` configurada, toda la superficie responde 401.
 */

export function requireBotKey(req: Request): Response | null {
  const rl = checkRateLimit("bot-api", { windowMs: 60_000, max: 600 });
  if (!rl.allowed) return apiError(429, "rate_limited", "Demasiadas solicitudes");

  const expected = process.env.BOT_API_KEY;
  const provided = req.headers.get("x-api-key");
  if (!expected || expected.length < 16 || !provided) {
    return apiError(401, "unauthorized", "No autorizado");
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return apiError(401, "unauthorized", "No autorizado");
  }
  return null;
}

/**
 * La organización de la instancia, SOLO si atiende a un único negocio.
 *
 * `BOT_API_KEY` es una clave por instancia, no por negocio: un cerebro externo
 * que conduce conversaciones tiene que saber en qué tenant escribe. Con una
 * sola organización es la suya; con dos o más ya no se puede deducir —y elegir
 * "la primera" repartiría contactos y mensajes entre clientes—, así que la
 * superficie `/api/bot/*` responde 409 hasta que se despeje la ambigüedad (una
 * instancia por cliente, o una clave por negocio).
 *
 * Se cachea con caducidad corta porque el alta de un segundo negocio ocurre en
 * runtime: un cache permanente seguiría sirviendo el id anterior.
 */
const ORG_CACHE_MS = 60_000;
let cached: { organizationId: string | null; at: number } | null = null;

export async function resolveInstanceOrg(): Promise<string | null> {
  if (cached && Date.now() - cached.at < ORG_CACHE_MS) return cached.organizationId;
  const db = getDb();
  const rows = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .orderBy(asc(schema.organization.createdAt), asc(schema.organization.id))
    .limit(2);
  const organizationId = rows.length === 1 ? (rows[0]?.id ?? null) : null;
  cached = { organizationId, at: Date.now() };
  return organizationId;
}

/** Solo para tests. */
export function resetInstanceOrgCache(): void {
  cached = null;
}
