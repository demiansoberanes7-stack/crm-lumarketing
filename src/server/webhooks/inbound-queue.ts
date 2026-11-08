import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { safeDiagnosticText } from "@/server/diagnostics/redact";
import { processInboundWebhookEvent } from "@/server/webhooks/inbound-dispatch";

/** A single provider adapter and tenant-scoped envelope. */
export type InboundWebhookProvider =
  | "meta_whatsapp"
  | "waha"
  | "meta_instagram"
  | "meta_messenger"
  | "zernio_instagram"
  | "zernio_messenger"
  | "zernio_tiktok"
  | "zernio_whatsapp";

export type EnqueueInboundWebhookInput = {
  organizationId: string;
  provider: InboundWebhookProvider;
  /** Stable provider item identity when available; otherwise canonical payload hash. */
  idempotencyKey: string;
  eventType: string;
  /** Raw JSON envelope restricted to this organization. */
  rawBody: string;
};

const POLL_MS = 1_000;
const BATCH_SIZE = 10;
const LEASE_MS = 5 * 60_000;
const HEARTBEAT_MS = 30_000;
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 5 * 60_000;
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60_000;
const PRUNE_INTERVAL_MS = 24 * 60 * 60_000;

export type InboundEventRecord = typeof schema.inboundWebhookEvent.$inferSelect;
type InboundEventRow = InboundEventRecord;

const workerState = globalThis as typeof globalThis & {
  __inboundWebhookPoll?: ReturnType<typeof setInterval>;
  __inboundWebhookTick?: boolean;
  __inboundWebhookPausedForTest?: boolean;
  __inboundWebhookPrunedAt?: number;
};

export function inboundWebhookEventKey(
  provider: InboundWebhookProvider,
  organizationId: string,
  stableIdentity: string
): string {
  return createHash("sha256")
    .update(`${provider}\0${organizationId}\0${stableIdentity}`)
    .digest("hex");
}

export function inboundWebhookPayloadKey(
  provider: InboundWebhookProvider,
  organizationId: string,
  rawBody: string
): string {
  return inboundWebhookEventKey(provider, organizationId, rawBody);
}

/**
 * Durable receipt. Returning from this function means the pending row has
 * committed; a duplicate returns only after confirming its tombstone exists.
 */
export async function enqueueInboundWebhook(
  input: EnqueueInboundWebhookInput
): Promise<{ persisted: true; duplicate: boolean }> {
  const db = getDb();
  const id = newId("inboundWebhookEvent");
  const [inserted] = await db
    .insert(schema.inboundWebhookEvent)
    .values({
      id,
      organizationId: input.organizationId,
      provider: input.provider,
      idempotencyKey: input.idempotencyKey,
      eventType: input.eventType.slice(0, 80),
      rawBody: input.rawBody,
      status: "pending",
      runAt: new Date(),
      lockedUntil: null,
      lockToken: null,
      attempts: 0,
      lastError: null,
      receivedAt: new Date(),
      processedAt: null,
    })
    .onConflictDoNothing({
      target: [
        schema.inboundWebhookEvent.organizationId,
        schema.inboundWebhookEvent.provider,
        schema.inboundWebhookEvent.idempotencyKey,
      ],
    })
    .returning({ id: schema.inboundWebhookEvent.id });
  if (inserted) return { persisted: true, duplicate: false };

  const [existing] = await db
    .select({ id: schema.inboundWebhookEvent.id })
    .from(schema.inboundWebhookEvent)
    .where(
      scoped(
        schema.inboundWebhookEvent.organizationId,
        input.organizationId,
        eq(schema.inboundWebhookEvent.provider, input.provider),
        eq(schema.inboundWebhookEvent.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);
  if (!existing) {
    // A conflict without its matching row means a transient/other constraint
    // failure; don't ACK an event we cannot prove is durably represented.
    throw new Error("La recepción durable del webhook no quedó confirmada");
  }
  return { persisted: true, duplicate: true };
}

function retryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

/** @internal Exposed for deterministic lease/concurrency tests. */
export async function claimInboundWebhookEvent(now: Date): Promise<InboundEventRow | null> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(schema.inboundWebhookEvent)
      .where(
        and(
          eq(schema.inboundWebhookEvent.status, "pending"),
          lte(schema.inboundWebhookEvent.runAt, now),
          or(
            isNull(schema.inboundWebhookEvent.lockedUntil),
            lte(schema.inboundWebhookEvent.lockedUntil, now)
          )
        )
      )
      .orderBy(asc(schema.inboundWebhookEvent.runAt), asc(schema.inboundWebhookEvent.receivedAt))
      .for("update", { skipLocked: true })
      .limit(1);
    if (!candidate) return null;

    const lockToken = randomUUID();
    const [claimed] = await tx
      .update(schema.inboundWebhookEvent)
      .set({
        lockToken,
        lockedUntil: new Date(now.getTime() + LEASE_MS),
        attempts: sql`${schema.inboundWebhookEvent.attempts} + 1`,
      })
      .where(
        and(
          scoped(
            schema.inboundWebhookEvent.organizationId,
            candidate.organizationId,
            eq(schema.inboundWebhookEvent.id, candidate.id)
          ),
          eq(schema.inboundWebhookEvent.status, "pending")
        )
      )
      .returning();
    return (claimed as InboundEventRow | undefined) ?? null;
  });
}

async function renewLease(event: InboundEventRow): Promise<void> {
  if (!event.lockToken) return;
  await getDb()
    .update(schema.inboundWebhookEvent)
    .set({ lockedUntil: new Date(Date.now() + LEASE_MS) })
    .where(
      scoped(
        schema.inboundWebhookEvent.organizationId,
        event.organizationId,
        and(
          eq(schema.inboundWebhookEvent.id, event.id),
          eq(schema.inboundWebhookEvent.status, "pending"),
          eq(schema.inboundWebhookEvent.lockToken, event.lockToken)
        )
      )
    );
}

async function finishProcessed(event: InboundEventRow): Promise<void> {
  if (!event.lockToken) return;
  await getDb()
    .update(schema.inboundWebhookEvent)
    .set({
      status: "processed",
      rawBody: null,
      processedAt: new Date(),
      lockedUntil: null,
      lockToken: null,
      lastError: null,
    })
    .where(
      scoped(
        schema.inboundWebhookEvent.organizationId,
        event.organizationId,
        and(
          eq(schema.inboundWebhookEvent.id, event.id),
          eq(schema.inboundWebhookEvent.status, "pending"),
          eq(schema.inboundWebhookEvent.lockToken, event.lockToken)
        )
      )
    );
}

async function finishFailed(event: InboundEventRow, error: unknown): Promise<boolean> {
  if (!event.lockToken) return false;
  const now = new Date();
  const lastError = safeDiagnosticText(error instanceof Error ? error.message : String(error), 1000);
  const failed = event.attempts >= MAX_ATTEMPTS;
  await getDb()
    .update(schema.inboundWebhookEvent)
    .set({
      status: failed ? "failed" : "pending",
      runAt: failed ? event.runAt : new Date(now.getTime() + retryDelay(event.attempts)),
      lockedUntil: null,
      lockToken: null,
      lastError,
    })
    .where(
      scoped(
        schema.inboundWebhookEvent.organizationId,
        event.organizationId,
        and(
          eq(schema.inboundWebhookEvent.id, event.id),
          eq(schema.inboundWebhookEvent.status, "pending"),
          eq(schema.inboundWebhookEvent.lockToken, event.lockToken)
        )
      )
    );
  return failed;
}

async function pruneTerminalEvents(now: Date): Promise<void> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - TERMINAL_RETENTION_MS);
  // This maintenance query only enumerates tenant ids; each delete is scoped.
  const organizations = await db
    .select({ id: schema.organization.id })
    .from(schema.organization);
  for (const organization of organizations) {
    await db
      .delete(schema.inboundWebhookEvent)
      .where(
        scoped(
          schema.inboundWebhookEvent.organizationId,
          organization.id,
          inArray(schema.inboundWebhookEvent.status, ["processed", "failed"]),
          lt(schema.inboundWebhookEvent.receivedAt, cutoff)
        )
      );
  }
}

async function maybePrune(now: Date): Promise<void> {
  const last = workerState.__inboundWebhookPrunedAt ?? 0;
  if (now.getTime() - last < PRUNE_INTERVAL_MS) return;
  // Set before awaiting: concurrent ticks must not run the same tenant sweep.
  workerState.__inboundWebhookPrunedAt = now.getTime();
  try {
    await pruneTerminalEvents(now);
  } catch (error) {
    console.error("[webhook-queue] no se pudo limpiar el histórico terminal:", safeDiagnosticText(String(error)));
    workerState.__inboundWebhookPrunedAt = last;
  }
}

export type InboundWebhookWorkerResult = {
  processed: number;
  retried: number;
  failed: number;
};

export async function runInboundWebhookWorkerOnce(
  now = new Date()
): Promise<InboundWebhookWorkerResult> {
  const result: InboundWebhookWorkerResult = { processed: 0, retried: 0, failed: 0 };
  if (workerState.__inboundWebhookTick || workerState.__inboundWebhookPausedForTest) return result;
  workerState.__inboundWebhookTick = true;
  try {
    await maybePrune(now);
    for (let index = 0; index < BATCH_SIZE; index++) {
      const event = await claimInboundWebhookEvent(now);
      if (!event) break;
      const heartbeat = setInterval(() => {
        void renewLease(event).catch((error) => {
          console.error(
            `[webhook-queue] no se pudo renovar lease ${event.id}:`,
            safeDiagnosticText(String(error))
          );
        });
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      try {
        if (!event.rawBody) throw new Error("El evento pendiente no tiene payload");
        await processInboundWebhookEvent(event);
        await finishProcessed(event);
        result.processed++;
      } catch (error) {
        const terminal = await finishFailed(event, error);
        if (terminal) result.failed++;
        else result.retried++;
        console.error(
          `[webhook-queue] evento ${event.id} (org ${event.organizationId}, intento ${event.attempts}) ${terminal ? "fallido" : "reprogramado"}:`,
          safeDiagnosticText(error instanceof Error ? error.message : String(error), 1000)
        );
      } finally {
        clearInterval(heartbeat);
      }
    }
    return result;
  } catch (error) {
    // Leave any claimed row leased; if this process dies, another worker can
    // recover it when `locked_until` expires. Never turn a poll exception into
    // an unhandled rejection from the interval.
    console.error(
      "[webhook-queue] falló el ciclo del worker:",
      safeDiagnosticText(error instanceof Error ? error.message : String(error), 1000)
    );
    return result;
  } finally {
    workerState.__inboundWebhookTick = false;
  }
}

export function inboundWebhookWorkerReady(): boolean {
  return Boolean(workerState.__inboundWebhookPoll);
}

/** Test-only switch; the only HTTP caller is behind mockGuard(). */
export function setInboundWebhookWorkerPausedForTest(paused: boolean): void {
  workerState.__inboundWebhookPausedForTest = paused;
}

export async function startInboundWebhookWorker(): Promise<void> {
  if (workerState.__inboundWebhookPoll) return;
  // The app instrumentation runs after migrations. Process existing pending
  // receipts immediately, then poll at one-second intervals for low latency.
  void runInboundWebhookWorkerOnce();
  workerState.__inboundWebhookPoll = setInterval(() => {
    void runInboundWebhookWorkerOnce();
  }, POLL_MS);
  workerState.__inboundWebhookPoll.unref?.();
}
