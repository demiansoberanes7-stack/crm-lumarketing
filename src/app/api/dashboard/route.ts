import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { buildDashboard } from "@/server/dashboard/metrics";

export const dynamic = "force-dynamic";
export const GET = withAuth(async (session, req: Request) => {
  const period = new URL(req.url).searchParams.get("period") ?? "30d";
  if (!["7d", "30d", "90d", "1y"].includes(period)) return apiError(422, "invalid_period", "Período inválido");
  const orgId = session.organizationId;
  // One repeatable snapshot: a payment and its charge update cannot be observed halfway.
  const data = await getDb().transaction(async (db) => {
    const now = new Date();
    const [projects, stages, stageEvents, tasks, quotes, charges, payments, expenses, conversations, contacts, members] = await Promise.all([
      db.select().from(schema.project).where(scoped(schema.project.organizationId, orgId)),
      db.select().from(schema.projectStage).where(scoped(schema.projectStage.organizationId, orgId)),
      db.select().from(schema.projectStageEvent).where(scoped(schema.projectStageEvent.organizationId, orgId)),
      db.select().from(schema.projectTask).where(scoped(schema.projectTask.organizationId, orgId)),
      db.select().from(schema.quote).where(scoped(schema.quote.organizationId, orgId)),
      db.select().from(schema.charge).where(scoped(schema.charge.organizationId, orgId)),
      db.select().from(schema.payment).where(scoped(schema.payment.organizationId, orgId)),
      db.select().from(schema.expense).where(scoped(schema.expense.organizationId, orgId)),
      db.select().from(schema.conversation).where(scoped(schema.conversation.organizationId, orgId)),
      db.select().from(schema.contact).where(scoped(schema.contact.organizationId, orgId)),
      db.select({ id: schema.user.id, name: schema.user.name }).from(schema.member).innerJoin(schema.user, eq(schema.member.userId, schema.user.id)).where(scoped(schema.member.organizationId, orgId)),
    ]);
    return buildDashboard({ projects, stages, stageEvents, tasks, quotes, charges, payments, expenses, conversations, contacts, members }, period, now);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  return Response.json(data);
});
