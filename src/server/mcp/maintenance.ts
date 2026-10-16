import { and, isNotNull, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  mcpAccessToken,
  mcpActionAudit,
  mcpAuthorizationCode,
  mcpOauthClient,
} from "@/lib/db/schema";

/**
 * Mantenimiento MCP in-process: barre lo que caducó para que en la BD no
 * queden filas huérfanas (códigos, tokens, auditoría vieja y clientes DCR
 * muertos). Nunca bloquea ni rompe una operación: sus fallos solo se loguean.
 * Singleton en globalThis — una instancia = un proceso.
 */

const SWEEP_MS = 60 * 60_000; // cada hora
const DAY_MS = 86_400_000;
const CLIENT_DEAD_AFTER_MS = 90 * DAY_MS;

const workerState = globalThis as typeof globalThis & {
  __mcpMaintenance?: ReturnType<typeof setInterval>;
  __mcpMaintenanceTick?: boolean;
};

function auditRetentionMs(): number {
  const days = Number(process.env.MCP_AUDIT_RETENTION_DAYS ?? "180");
  const safeDays = Number.isFinite(days) && days > 0 ? days : 180;
  return safeDays * DAY_MS;
}

export function startMcpMaintenance(): Promise<void> {
  if (workerState.__mcpMaintenance) return Promise.resolve();
  if (process.env.MCP_MAINTENANCE_ENABLED === "false") return Promise.resolve();
  // Barrido inmediato diferido: el proceso todavía está compilando rutas.
  setTimeout(() => void runMcpMaintenanceOnce(), 120_000).unref?.();
  workerState.__mcpMaintenance = setInterval(() => {
    void runMcpMaintenanceOnce();
  }, SWEEP_MS);
  workerState.__mcpMaintenance.unref?.();
  return Promise.resolve();
}

/** Un barrido completo. Exportado para tests. */
export async function runMcpMaintenanceOnce(): Promise<void> {
  if (workerState.__mcpMaintenanceTick) return;
  workerState.__mcpMaintenanceTick = true;
  try {
    const db = getDb();
    const now = new Date();
    const sinceAudit = new Date(now.getTime() - auditRetentionMs());
    const sinceClient = new Date(now.getTime() - CLIENT_DEAD_AFTER_MS);

    // 1. Códigos de autorización: viven 5 minutos; se limpian al día.
    const codes = await db
      .delete(mcpAuthorizationCode)
      .where(lt(mcpAuthorizationCode.expiresAt, new Date(now.getTime() - DAY_MS)))
      .returning({ id: mcpAuthorizationCode.id });

    // 2. Tokens: caducados, o revocados hace más de una semana.
    const tokens = await db
      .delete(mcpAccessToken)
      .where(
        or(
          lt(mcpAccessToken.expiresAt, now),
          and(
            isNotNull(mcpAccessToken.revokedAt),
            lt(mcpAccessToken.revokedAt, new Date(now.getTime() - 7 * DAY_MS))
          )
        )
      )
      .returning({ id: mcpAccessToken.id });

    // 3. Auditoría de acciones según retención configurada.
    const audits = await db
      .delete(mcpActionAudit)
      .where(lt(mcpActionAudit.createdAt, sinceAudit))
      .returning({ id: mcpActionAudit.id });

    // 4. Clientes DCR sin actividad reciente (su token duró 1 hora, así que
    //    90 días de quietud garantiza que ninguno siga vivo).
    const clients = await db
      .delete(mcpOauthClient)
      .where(
        or(
          and(
            isNull(mcpOauthClient.lastUsedAt),
            lt(mcpOauthClient.createdAt, sinceClient)
          ),
          and(
            isNotNull(mcpOauthClient.lastUsedAt),
            lt(mcpOauthClient.lastUsedAt, sinceClient)
          )
        )
      )
      .returning({ id: mcpOauthClient.id });

    const total = codes.length + tokens.length + audits.length + clients.length;
    if (total > 0) {
      console.log(
        `[mcp] mantenimiento: ${codes.length} código(s), ${tokens.length} token(s), ` +
          `${audits.length} auditoría(s), ${clients.length} cliente(s) podados`
      );
    }
  } catch (err) {
    // La BD puede no estar lista aún (migraciones corren antes del server).
    console.error("[mcp] mantenimiento falló:", err);
  } finally {
    workerState.__mcpMaintenanceTick = false;
  }
}
