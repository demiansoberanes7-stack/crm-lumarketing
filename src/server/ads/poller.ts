import { listOrganizationsWithMetaAds, syncMetaAdsInsights } from "@/server/ads/sync";

/**
 * Poller in-process de insights de Meta Ads (patrón google-business/poller):
 * cada 15 minutos barre las organizaciones con credenciales y persiste las
 * métricas de campañas en `campaign_insight`. Singleton en globalThis — una
 * instancia = un proceso. Su fallo jamás bloquea nada: cada org se intenta por
 * su cuenta y los errores van a stdout (diagnóstico best-effort).
 *
 * No necesita bandera: Meta Ads no es un módulo opcional (ADR-001); si la org
 * no tiene credenciales, simplemente no se sincroniza.
 */

const POLL_MS = 15 * 60_000;

const workerState = globalThis as typeof globalThis & {
  __metaAdsPoll?: ReturnType<typeof setInterval>;
  __metaAdsTick?: boolean;
};

export function metaAdsWorkerReady(): boolean {
  return Boolean(workerState.__metaAdsPoll);
}

export async function startMetaAdsWorker(): Promise<void> {
  if (workerState.__metaAdsPoll) return;
  // Barrido inmediato diferido: el proceso todavía está compilando rutas.
  setTimeout(() => void runMetaAdsWorkerOnce(), 90_000).unref?.();
  workerState.__metaAdsPoll = setInterval(() => {
    void runMetaAdsWorkerOnce();
  }, POLL_MS);
  workerState.__metaAdsPoll.unref?.();
}

/** Un barrido de todas las orgs con credenciales. Exportado para tests. */
export async function runMetaAdsWorkerOnce(): Promise<void> {
  if (workerState.__metaAdsTick) return;
  workerState.__metaAdsTick = true;
  try {
    const orgIds = await listOrganizationsWithMetaAds();
    for (const organizationId of orgIds) {
      try {
        await syncMetaAdsInsights(organizationId);
      } catch (err) {
        console.error("[ads] sync falló para", organizationId, err);
      }
    }
  } catch (err) {
    // La BD puede no estar lista al arrancar.
    console.error("[ads] barrido falló:", err);
  } finally {
    workerState.__metaAdsTick = false;
  }
}
