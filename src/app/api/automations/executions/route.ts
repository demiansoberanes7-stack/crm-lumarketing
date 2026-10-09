import { desc, eq, gte, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/**
 * GET /api/automations/executions
 * La cola de automatizaciones, fila por fila: qué regla corrió, por qué
 * disparo, si salió y con qué error. La UI lee la cola por `/metrics` (que
 * es agregado por etapa); este endpoint es para depurar y para los E2E, que
 * necesitan comprobar el disparo exacto en vez de adivinarlo contando totales.
 */
export const GET = withAuth(async (session, req: Request) => {
  const params = req.url ? new URL(req.url).searchParams : null;

  const limitRaw = Number(params?.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;
  const sinceRaw = params?.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  const ruleId = params?.get("ruleId") ?? null;

  const db = getDb();
  const conditions = [];
  if (since && !Number.isNaN(since.getTime())) {
    conditions.push(gte(schema.automationExecution.createdAt, since));
  }
  if (ruleId) {
    conditions.push(eq(schema.automationExecution.ruleId, ruleId));
  }

  const rows = await db
    .select({
      id: schema.automationExecution.id,
      ruleId: schema.automationExecution.ruleId,
      triggeredBy: schema.automationExecution.triggeredBy,
      status: schema.automationExecution.status,
      attempts: schema.automationExecution.attempts,
      scheduledAt: schema.automationExecution.scheduledAt,
      startedAt: schema.automationExecution.startedAt,
      sentAt: schema.automationExecution.sentAt,
      error: schema.automationExecution.error,
      createdAt: schema.automationExecution.createdAt,
      conversationId: schema.automationExecution.conversationId,
    })
    .from(schema.automationExecution)
    .where(
      scoped(schema.automationExecution.organizationId, session.organizationId, ...conditions)
    )
    .orderBy(desc(schema.automationExecution.createdAt), sql`${schema.automationExecution.id} desc`)
    .limit(limit);

  return Response.json({ executions: rows });
});
