import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/** Rebuilds aggregate counters from the durable recipient ledger. */
export async function refreshBroadcastCampaign(organizationId: string, campaignId: string) {
  const db = getDb();
  const rows = await db
    .select({ status: schema.broadcastRecipient.status, total: count() })
    .from(schema.broadcastRecipient)
    .where(
      scoped(
        schema.broadcastRecipient.organizationId,
        organizationId,
        eq(schema.broadcastRecipient.campaignId, campaignId)
      )
    )
    .groupBy(schema.broadcastRecipient.status);
  const totals = new Map(rows.map((row) => [row.status, Number(row.total)]));
  const sentCount = (totals.get("sent") ?? 0) + (totals.get("delivered") ?? 0) + (totals.get("read") ?? 0);
  const deliveredCount = (totals.get("delivered") ?? 0) + (totals.get("read") ?? 0);
  const readCount = totals.get("read") ?? 0;
  const failedCount = totals.get("failed") ?? 0;
  const skippedCount = totals.get("skipped") ?? 0;
  const pendingCount = (totals.get("queued") ?? 0) + (totals.get("sending") ?? 0);
  const [campaign] = await db
    .select({ status: schema.broadcastCampaign.status })
    .from(schema.broadcastCampaign)
    .where(scoped(schema.broadcastCampaign.organizationId, organizationId, eq(schema.broadcastCampaign.id, campaignId)))
    .limit(1);
  const completed = (campaign?.status === "sending" || campaign?.status === "paused") && pendingCount === 0;
  await db
    .update(schema.broadcastCampaign)
    .set({
      sentCount,
      deliveredCount,
      readCount,
      failedCount,
      skippedCount,
      ...(completed ? { status: "completed", completedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(scoped(schema.broadcastCampaign.organizationId, organizationId, eq(schema.broadcastCampaign.id, campaignId)));
}

export async function applyBroadcastMessageStatus(input: {
  organizationId: string;
  messageId: string;
  status: "delivered" | "read" | "failed";
  errorCode?: string | null;
  errorMessage?: string | null;
}) {
  const db = getDb();
  const recipients = await db
    .select({ id: schema.broadcastRecipient.id, campaignId: schema.broadcastRecipient.campaignId })
    .from(schema.broadcastRecipient)
    .where(
      scoped(
        schema.broadcastRecipient.organizationId,
        input.organizationId,
        eq(schema.broadcastRecipient.messageId, input.messageId)
      )
    );
  for (const recipient of recipients) {
    const now = new Date();
    await db
      .update(schema.broadcastRecipient)
      .set({
        status: input.status,
        ...(input.status === "delivered" ? { deliveredAt: now } : {}),
        ...(input.status === "read" ? { deliveredAt: now, readAt: now } : {}),
        ...(input.status === "failed"
          ? {
              errorCode: input.errorCode?.slice(0, 80) ?? null,
              errorMessage: input.errorMessage?.slice(0, 500) ?? null,
            }
          : {}),
        updatedAt: now,
      })
      .where(scoped(schema.broadcastRecipient.organizationId, input.organizationId, eq(schema.broadcastRecipient.id, recipient.id)));
    await refreshBroadcastCampaign(input.organizationId, recipient.campaignId);
  }
}
