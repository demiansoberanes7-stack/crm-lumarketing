import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { findAutomationRule } from "@/server/automation-rules";
import { getIntegration } from "@/server/integrations";
import { triggerAiFollowUp } from "@/server/temporal/activities/follow-up";

const POLL_MS = 5_000;
const MAX_ATTEMPTS = 3;
const STALE_AFTER_MS = 10 * 60_000;

type Execution = typeof schema.automationExecution.$inferSelect;

const workerState = globalThis as typeof globalThis & {
  __automationPoll?: ReturnType<typeof setInterval>;
  __automationTick?: boolean;
};

export async function enqueueFollowUp(input: {
  organizationId: string;
  conversationId: string;
  delayHours: number;
  triggeredBy: "manual" | "stage";
}): Promise<string> {
  const db = getDb();

  if (input.triggeredBy === "stage") {
    const [existing] = await db
      .select({ id: schema.automationExecution.id })
      .from(schema.automationExecution)
      .where(
        scoped(
          schema.automationExecution.organizationId,
          input.organizationId,
          eq(schema.automationExecution.conversationId, input.conversationId),
          eq(schema.automationExecution.ruleId, "followup-3d"),
          sql`${schema.automationExecution.triggeredBy} = 'stage'`,
          sql`${schema.automationExecution.status} IN ('queued', 'running')`
        )
      )
      .limit(1);
    if (existing) return existing.id;
  }

  const id = newId("automationExecution");
  const now = new Date();
  await db.insert(schema.automationExecution).values({
    id,
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    ruleId: "followup-3d",
    triggeredBy: input.triggeredBy,
    status: "queued",
    scheduledAt: new Date(now.getTime() + input.delayHours * 60 * 60_000),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export function automationWorkerReady(): boolean {
  return Boolean(workerState.__automationPoll);
}

/** Recover work interrupted by a process restart and begin polling Postgres. */
export async function startAutomationWorker(): Promise<void> {
  if (workerState.__automationPoll) return;
  try {
    const now = new Date();
    await getDb()
      .update(schema.automationExecution)
      .set({ status: "queued", startedAt: null, scheduledAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.automationExecution.status, "running"),
          lte(
            schema.automationExecution.startedAt,
            new Date(now.getTime() - STALE_AFTER_MS)
          )
        )
      );
  } catch (err) {
    console.error("[automations] No se pudieron recuperar ejecuciones pendientes:", err);
  }

  workerState.__automationPoll = setInterval(() => {
    void runAutomationWorkerOnce();
  }, POLL_MS);
  workerState.__automationPoll.unref?.();
  void runAutomationWorkerOnce();
}

/** Exported for deterministic tests and one immediate startup pass. */
export async function runAutomationWorkerOnce(): Promise<void> {
  if (workerState.__automationTick) return;
  workerState.__automationTick = true;
  try {
    const db = getDb();
    const now = new Date();
    const due = await db
      .select()
      .from(schema.automationExecution)
      .where(
        and(
          eq(schema.automationExecution.status, "queued"),
          lte(schema.automationExecution.scheduledAt, now)
        )
      )
      .orderBy(asc(schema.automationExecution.scheduledAt))
      .limit(10);

    for (const execution of due) {
      const [claimed] = await db
        .update(schema.automationExecution)
        .set({
          status: "running",
          startedAt: now,
          attempts: sql`${schema.automationExecution.attempts} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.automationExecution.id, execution.id),
            eq(schema.automationExecution.status, "queued"),
            lte(schema.automationExecution.scheduledAt, now)
          )
        )
        .returning();
      if (claimed) await processExecution(claimed);
    }
  } catch (err) {
    console.error("[automations] Falló el ciclo del programador:", err);
  } finally {
    workerState.__automationTick = false;
  }
}

async function processExecution(execution: Execution): Promise<void> {
  const db = getDb();
  try {
    const [conversation] = await db
      .select({ id: schema.conversation.id, contactId: schema.conversation.contactId })
      .from(schema.conversation)
      .where(
        scoped(
          schema.conversation.organizationId,
          execution.organizationId,
          eq(schema.conversation.id, execution.conversationId)
        )
      )
      .limit(1);
    if (!conversation) {
      await finishExecution(execution.id, "cancelled", "La conversación ya no existe");
      return;
    }

    const [inbound] = await db
      .select({ id: schema.message.id })
      .from(schema.message)
      .where(
        scoped(
          schema.message.organizationId,
          execution.organizationId,
          eq(schema.message.conversationId, execution.conversationId),
          eq(schema.message.direction, "in"),
          gte(schema.message.createdAt, execution.createdAt)
        )
      )
      .limit(1);
    const [emailInbound] = conversation.contactId
      ? await db
          .select({ id: schema.emailMessage.id })
          .from(schema.emailMessage)
          .where(
            scoped(
              schema.emailMessage.organizationId,
              execution.organizationId,
              eq(schema.emailMessage.contactId, conversation.contactId),
              eq(schema.emailMessage.direction, "inbound"),
              gte(schema.emailMessage.createdAt, execution.createdAt)
            )
          )
          .limit(1)
      : [];
    if (inbound || emailInbound) {
      await finishExecution(execution.id, "cancelled", "El contacto respondió antes del seguimiento");
      return;
    }

    const integration = await getIntegration(execution.organizationId, "automation_rules");
    const rule = findAutomationRule(integration?.credentials?.rules, execution.ruleId);
    if (execution.triggeredBy === "stage" && rule?.enabled === false) {
      await finishExecution(execution.id, "cancelled", "La regla fue desactivada antes de ejecutarse");
      return;
    }

    await triggerAiFollowUp(execution.conversationId, execution.organizationId);
    await db
      .update(schema.automationExecution)
      .set({ status: "sent", sentAt: new Date(), error: null, updatedAt: new Date() })
      .where(eq(schema.automationExecution.id, execution.id));
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    const retry = execution.attempts < MAX_ATTEMPTS;
    const now = new Date();
    await db
      .update(schema.automationExecution)
      .set({
        status: retry ? "queued" : "failed",
        scheduledAt: retry
          ? new Date(now.getTime() + execution.attempts * 60_000)
          : execution.scheduledAt,
        startedAt: null,
        error: message,
        updatedAt: now,
      })
      .where(eq(schema.automationExecution.id, execution.id));
    console.error(`[automations] Seguimiento ${execution.id} falló:`, message);
  }
}

async function finishExecution(
  id: string,
  status: "cancelled",
  reason: string
): Promise<void> {
  await getDb()
    .update(schema.automationExecution)
    .set({ status, error: reason, updatedAt: new Date() })
    .where(eq(schema.automationExecution.id, id));
}

export async function getAutomationMetrics(organizationId: string) {
  const [integration, aggregate] = await Promise.all([
    getIntegration(organizationId, "automation_rules"),
    getDb().execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE a.status = 'sent')::int AS sent,
        COUNT(*) FILTER (
          WHERE a.status = 'sent' AND a.sent_at <= now() - interval '7 days'
        )::int AS eligible,
        COUNT(*) FILTER (
          WHERE a.status = 'sent'
            AND a.sent_at <= now() - interval '7 days'
            AND (
              EXISTS (
                SELECT 1 FROM message m
                WHERE m.organization_id = a.organization_id
                  AND m.conversation_id = a.conversation_id
                  AND m.direction = 'in'
                  AND m.created_at >= a.sent_at
                  AND m.created_at < a.sent_at + interval '7 days'
              ) OR EXISTS (
                SELECT 1 FROM conversation c
                JOIN email_message em
                  ON em.organization_id = c.organization_id
                 AND em.contact_id = c.contact_id
                WHERE c.organization_id = a.organization_id
                  AND c.id = a.conversation_id
                  AND em.direction = 'inbound'
                  AND em.created_at >= a.sent_at
                  AND em.created_at < a.sent_at + interval '7 days'
              )
            )
        )::int AS responded
      FROM automation_execution a
      WHERE a.organization_id = ${organizationId}
        AND a.sent_at >= now() - interval '30 days'
    `),
  ]);
  const row = aggregate[0] as
    | { sent: number; eligible: number; responded: number }
    | undefined;
  const sent = Number(row?.sent ?? 0);
  const eligible = Number(row?.eligible ?? 0);
  const responded = Number(row?.responded ?? 0);
  const rules = integration?.credentials?.rules;
  const activeFlows = Array.isArray(rules)
    ? rules.filter((rule) =>
        typeof rule === "object" && rule !== null && "enabled" in rule && rule.enabled === true
      ).length
    : 1; // La regla preset de seguimiento se considera activa por defecto.

  return {
    activeFlows,
    sent,
    eligible,
    responded,
    responseRate: eligible ? Math.round((responded / eligible) * 100) : 0,
    periodDays: 30,
    responseWindowDays: 7,
    schedulerReady: automationWorkerReady(),
  };
}
