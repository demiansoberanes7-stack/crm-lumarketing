import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isChannelEnabled } from "@/server/channels/enabled";
import { syncOrganizationComments } from "@/server/comments/sync";

/**
 * Poller in-process de comentarios de publicaciones (patrón
 * google-business/poller): cada 5 minutos barre las organizaciones con
 * credenciales de Instagram/Messenger vía Meta y sincroniza sus comentarios
 * hacia la Bandeja. Singleton en globalThis — una instancia = un proceso. Su
 * fallo jamás bloquea nada: cada org se intenta por su cuenta.
 */

const POLL_MS = 5 * 60_000;

const workerState = globalThis as typeof globalThis & {
  __commentsPoll?: ReturnType<typeof setInterval>;
  __commentsTick?: boolean;
};

export function commentsWorkerReady(): boolean {
  return Boolean(workerState.__commentsPoll);
}

export async function startCommentsWorker(): Promise<void> {
  if (workerState.__commentsPoll) return;
  // Barrido inmediato diferido: el proceso todavía está compilando rutas.
  setTimeout(() => void runCommentsWorkerOnce(), 90_000).unref?.();
  workerState.__commentsPoll = setInterval(() => {
    void runCommentsWorkerOnce();
  }, POLL_MS);
  workerState.__commentsPoll.unref?.();
}

/** Un barrido de todas las orgs con credenciales. Exportado para tests. */
export async function runCommentsWorkerOnce(): Promise<void> {
  if (workerState.__commentsTick) return;
  // El canal `comments` viaja en CHANNELS; apagado = el poller no barre.
  if (!isChannelEnabled("comments")) return;
  workerState.__commentsTick = true;
  try {
    const db = getDb();
    // Solo las cuentas conectadas vía Meta pueden leer comentarios (Zernio no).
    const igOrgs = await db
      .select({ organizationId: schema.instagramCredentials.organizationId })
      .from(schema.instagramCredentials)
      .where(eq(schema.instagramCredentials.source, "meta"));
    const msOrgs = await db
      .select({ organizationId: schema.messengerCredentials.organizationId })
      .from(schema.messengerCredentials)
      .where(eq(schema.messengerCredentials.source, "meta"));
    const orgIds = new Set([
      ...igOrgs.map((r) => r.organizationId),
      ...msOrgs.map((r) => r.organizationId),
    ]);
    for (const organizationId of orgIds) {
      try {
        await syncOrganizationComments(organizationId);
      } catch (err) {
        console.error("[comments] sync falló para", organizationId, err);
      }
    }
  } catch (err) {
    // La BD puede no estar lista al arrancar.
    console.error("[comments] barrido falló:", err);
  } finally {
    workerState.__commentsTick = false;
  }
}
