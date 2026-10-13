import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { syncInbox } from "@/server/email/service";

/**
 * Poller in-process del buzón (IMAP): cada 3 minutos barre las cuentas de
 * correo habilitadas y trae los correos entrantes. Sin él, el correo solo
 * llegaba cuando alguien pulsaba el botón de sincronizar a mano.
 * Singleton en globalThis — una instancia = un proceso. Su fallo jamás
 * bloquea nada: cada cuenta se intenta por su cuenta.
 */

const POLL_MS = 3 * 60_000;

const workerState = globalThis as typeof globalThis & {
  __emailPoll?: ReturnType<typeof setInterval>;
  __emailTick?: boolean;
};

export function emailWorkerReady(): boolean {
  return Boolean(workerState.__emailPoll);
}

export async function startEmailWorker(): Promise<void> {
  if (workerState.__emailPoll) return;
  // Barrido inmediato diferido: el proceso todavía está compilando rutas.
  setTimeout(() => void runEmailWorkerOnce(), 60_000).unref?.();
  workerState.__emailPoll = setInterval(() => {
    void runEmailWorkerOnce();
  }, POLL_MS);
  workerState.__emailPoll.unref?.();
}

/** Un barrido de todas las cuentas habilitadas. Exportado para tests. */
export async function runEmailWorkerOnce(): Promise<void> {
  if (workerState.__emailTick) return;
  workerState.__emailTick = true;
  try {
    const rows = await getDb()
      .select({ id: schema.emailAccount.id, organizationId: schema.emailAccount.organizationId, emailAddress: schema.emailAccount.emailAddress })
      .from(schema.emailAccount)
      .where(eq(schema.emailAccount.enabled, true));
    for (const row of rows) {
      try {
        await syncInbox(row.organizationId, row.id);
      } catch (err) {
        console.error("[email] sync falló para", row.emailAddress, err);
      }
    }
  } catch (err) {
    // La BD puede no estar lista al arrancar.
    console.error("[email] barrido falló:", err);
  } finally {
    workerState.__emailTick = false;
  }
}
