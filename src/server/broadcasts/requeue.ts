import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * Un mensaje entrante reabre la ventana de servicio del canal. Los envíos
 * programados que estaban esperando ese momento vuelven a la cola de
 * inmediato: no hace falta esperar el reintento periódico del worker.
 *
 * No se toca el estado de la campaña: el worker comprueba que siga en
 * `sending` antes de entregar. Una campaña pausada conserva sus destinatarios
 * listos para cuando el operador la reanude.
 */
export async function requeueWaitingBroadcasts(
  organizationId: string,
  conversationId: string
): Promise<void> {
  const now = new Date();
  await getDb()
    .update(schema.broadcastRecipient)
    .set({
      status: "queued",
      skipReason: null,
      scheduledAt: now,
      updatedAt: now,
    })
    .where(
      and(
        scoped(schema.broadcastRecipient.organizationId, organizationId),
        eq(schema.broadcastRecipient.conversationId, conversationId),
        eq(schema.broadcastRecipient.status, "waiting_window")
      )
    );
}
