import { getDb, schema } from "@/lib/db";
import { isChannelEnabled } from "@/server/channels/enabled";
import { syncOrganization } from "@/server/mercado-libre/sync";

/**
 * Poller in-process de mensajes post-venta de Mercado Libre (patrón
 * automation-queue): cada 3 minutos barre las organizaciones con credenciales
 * y las sincroniza. Singleton en globalThis — una instancia = un proceso.
 * Su fallo jamás bloquea nada: cada org se intenta por su cuenta y los
 * errores van a diagnósticos.
 */

const POLL_MS = 3 * 60_000;

const workerState = globalThis as typeof globalThis & {
  __mlPoll?: ReturnType<typeof setInterval>;
  __mlTick?: boolean;
};

export function mercadoLibreWorkerReady(): boolean {
  return Boolean(workerState.__mlPoll);
}

export async function startMercadoLibreWorker(): Promise<void> {
  if (workerState.__mlPoll) return;
  // Barrido inmediato diferido: el proceso todavía está compilando rutas.
  setTimeout(() => void runMercadoLibreWorkerOnce(), 90_000).unref?.();
  workerState.__mlPoll = setInterval(() => {
    void runMercadoLibreWorkerOnce();
  }, POLL_MS);
  workerState.__mlPoll.unref?.();
}

/** Un barrido de todas las orgs con credenciales. Exportado para tests. */
export async function runMercadoLibreWorkerOnce(): Promise<void> {
  if (workerState.__mlTick) return;
  if (!isChannelEnabled("mercado_libre")) return;
  workerState.__mlTick = true;
  try {
    const rows = await getDb()
      .select({ organizationId: schema.marketplaceCredentials.organizationId })
      .from(schema.marketplaceCredentials);
    for (const row of rows) {
      try {
        await syncOrganization(row.organizationId);
      } catch (err) {
        console.error("[mercado-libre] sync falló para", row.organizationId, err);
      }
    }
  } catch (err) {
    // La BD puede no estar lista al arrancar.
    console.error("[mercado-libre] barrido falló:", err);
  } finally {
    workerState.__mlTick = false;
  }
}
