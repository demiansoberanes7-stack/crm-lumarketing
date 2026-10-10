import { and, asc, eq, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { refreshBroadcastCampaign } from "@/server/broadcasts/metrics";
import { SendError, sendText } from "@/server/inbox/send";

const POLL_MS = 2_000;
const BATCH_SIZE = 5;
const STALE_AFTER_MS = 5 * 60_000;

const workerState = globalThis as typeof globalThis & {
  __broadcastPoll?: ReturnType<typeof setInterval>;
  __broadcastTick?: boolean;
};

export function broadcastWorkerReady(): boolean {
  return Boolean(workerState.__broadcastPoll);
}

export async function startBroadcastWorker(): Promise<void> {
  if (workerState.__broadcastPoll) return;
  const db = getDb();
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await db
    .select({ organizationId: schema.broadcastRecipient.organizationId, campaignId: schema.broadcastRecipient.campaignId })
    .from(schema.broadcastRecipient)
    .where(and(eq(schema.broadcastRecipient.status, "sending"), lte(schema.broadcastRecipient.updatedAt, staleBefore)));
  await db
    .update(schema.broadcastRecipient)
    .set({
      status: "failed",
      errorCode: "send_interrupted",
      errorMessage: "El proceso se interrumpió durante el envío; verifica el resultado antes de reintentar.",
      updatedAt: new Date(),
    })
    .where(and(eq(schema.broadcastRecipient.status, "sending"), lte(schema.broadcastRecipient.updatedAt, staleBefore)));
  for (const row of stale) await refreshBroadcastCampaign(row.organizationId, row.campaignId);

  workerState.__broadcastPoll = setInterval(() => void runBroadcastWorkerOnce(), POLL_MS);
  workerState.__broadcastPoll.unref?.();
  void runBroadcastWorkerOnce();
}

export async function runBroadcastWorkerOnce(): Promise<void> {
  if (workerState.__broadcastTick) return;
  workerState.__broadcastTick = true;
  try {
    const db = getDb();
    const now = new Date();
    const due = await db
      .select({
        id: schema.broadcastRecipient.id,
        organizationId: schema.broadcastRecipient.organizationId,
        campaignId: schema.broadcastRecipient.campaignId,
        conversationId: schema.broadcastRecipient.conversationId,
        messageText: schema.broadcastCampaign.messageText,
      })
      .from(schema.broadcastRecipient)
      .innerJoin(schema.broadcastCampaign, eq(schema.broadcastCampaign.id, schema.broadcastRecipient.campaignId))
      .where(
        and(
          eq(schema.broadcastRecipient.status, "queued"),
          eq(schema.broadcastCampaign.status, "sending"),
          lte(schema.broadcastRecipient.scheduledAt, now)
        )
      )
      .orderBy(asc(schema.broadcastRecipient.scheduledAt))
      .limit(BATCH_SIZE);

    for (const recipient of due) {
      const [claimed] = await db
        .update(schema.broadcastRecipient)
        .set({
          status: "sending",
          attempts: sql`${schema.broadcastRecipient.attempts} + 1`,
          startedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            scoped(schema.broadcastRecipient.organizationId, recipient.organizationId, eq(schema.broadcastRecipient.id, recipient.id)),
            eq(schema.broadcastRecipient.status, "queued")
          )
        )
        .returning({ id: schema.broadcastRecipient.id });
      if (!claimed) continue;
      await deliver(recipient);
    }
  } catch (error) {
    console.error("[broadcasts] Falló el ciclo de envíos masivos:", error);
  } finally {
    workerState.__broadcastTick = false;
  }
}

async function deliver(input: {
  id: string;
  organizationId: string;
  campaignId: string;
  conversationId: string | null;
  messageText: string;
}) {
  const db = getDb();
  const now = new Date();
  const [campaign] = await db
    .select({ status: schema.broadcastCampaign.status })
    .from(schema.broadcastCampaign)
    .where(scoped(schema.broadcastCampaign.organizationId, input.organizationId, eq(schema.broadcastCampaign.id, input.campaignId)))
    .limit(1);
  if (campaign?.status !== "sending") {
    await db.update(schema.broadcastRecipient)
      .set({ status: "queued", startedAt: null, updatedAt: new Date() })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
    return;
  }
  if (!input.conversationId) {
    await db.update(schema.broadcastRecipient)
      .set({ status: "skipped", skipReason: "no_whatsapp_conversation", updatedAt: now })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
    await refreshBroadcastCampaign(input.organizationId, input.campaignId);
    return;
  }

  try {
    const result = await sendText({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      text: input.messageText,
    });
    await db.update(schema.broadcastRecipient)
      .set({ status: "sent", messageId: result.messageId, sentAt: new Date(), updatedAt: new Date() })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
  } catch (error) {
    const sendError = error instanceof SendError ? error : null;
    const skipped = sendError?.code === "window_closed";
    await db.update(schema.broadcastRecipient)
      .set({
        status: skipped ? "skipped" : "failed",
        skipReason: skipped ? "window_closed" : null,
        messageId: sendError?.messageId ?? null,
        errorCode: sendError?.code ?? "send_failed",
        errorMessage: (sendError?.message ?? "No se pudo entregar el mensaje.").slice(0, 500),
        updatedAt: new Date(),
      })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, input.id)));
  }
  await refreshBroadcastCampaign(input.organizationId, input.campaignId);
}
