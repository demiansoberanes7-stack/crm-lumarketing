import { getDb, schema } from "@/lib/db";
import { googleBusinessEnabled } from "@/server/google-business/flag";
import { syncOrganization } from "@/server/google-business/sync";

/**
 * Poller in-process de reseñas de Google Business (patrón automation-queue):
 * cada 5 minutos barre las organizaciones con credenciales y las sincroniza.
 * Singleton en globalThis — una instancia = un proceso. Su fallo jamás bloquea
 * nada: cada org se intenta por su cuenta y los errores van a diagnósticos.
 */

const POLL_MS = 5 * 60_000;

const workerState = globalThis as typeof globalThis & {
  __gbPoll?: ReturnType<typeof setInterval>;
  __gbTick?: boolean;
};

export function googleBusinessWorkerReady(): boolean {
  return Boolean(workerState.__gbPoll);
}

export async function startGoogleBusinessWorker(): Promise<void> {
  if (workerState.__gbPoll) return;
  // Barrido inmediato diferido: el proceso todavía está compilando rutas.
  setTimeout(() => void runGoogleBusinessWorkerOnce(), 60_000).unref?.();
  workerState.__gbPoll = setInterval(() => {
    void runGoogleBusinessWorkerOnce();
  }, POLL_MS);
  workerState.__gbPoll.unref?.();
}

/** Un barrido de todas las orgs con credenciales. Exportado para tests. */
export async function runGoogleBusinessWorkerOnce(): Promise<void> {
  if (workerState.__gbTick) return;
  if (!googleBusinessEnabled()) return;
  workerState.__gbTick = true;
  try {
    const rows = await getDb()
      .select({ organizationId: schema.googleBusinessCredentials.organizationId })
      .from(schema.googleBusinessCredentials);
    for (const row of rows) {
      try {
        await syncOrganization(row.organizationId);
      } catch (err) {
        console.error("[google-business] sync falló para", row.organizationId, err);
      }
    }
  } catch (err) {
    // La BD puede no estar lista al arrancar.
    console.error("[google-business] barrido falló:", err);
  } finally {
    workerState.__gbTick = false;
  }
}
