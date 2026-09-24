import { z } from "zod";
import { gte, lte, and, sql } from "drizzle-orm";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  tables: z.array(z.string().min(1)).min(1),
});

type TableEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orgColumn: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dateColumn: any;
};

const TABLE_MAP: Record<string, TableEntry> = {
  messages: { table: schema.message, orgColumn: schema.message.organizationId, dateColumn: schema.message.createdAt },
  conversations: { table: schema.conversation, orgColumn: schema.conversation.organizationId, dateColumn: schema.conversation.createdAt },
  leads: { table: schema.lead, orgColumn: schema.lead.organizationId, dateColumn: schema.lead.createdAt },
  leadStageEvents: { table: schema.leadStageEvent, orgColumn: schema.leadStageEvent.organizationId, dateColumn: schema.leadStageEvent.createdAt },
  projects: { table: schema.project, orgColumn: schema.project.organizationId, dateColumn: schema.project.createdAt },
  projectStageEvents: { table: schema.projectStageEvent, orgColumn: schema.projectStageEvent.organizationId, dateColumn: schema.projectStageEvent.createdAt },
  projectTasks: { table: schema.projectTask, orgColumn: schema.projectTask.organizationId, dateColumn: schema.projectTask.createdAt },
  quotes: { table: schema.quote, orgColumn: schema.quote.organizationId, dateColumn: schema.quote.createdAt },
  quoteEvents: { table: schema.quoteEvent, orgColumn: schema.quoteEvent.organizationId, dateColumn: schema.quoteEvent.createdAt },
  charges: { table: schema.charge, orgColumn: schema.charge.organizationId, dateColumn: schema.charge.createdAt },
  payments: { table: schema.payment, orgColumn: schema.payment.organizationId, dateColumn: schema.payment.createdAt },
  expenses: { table: schema.expense, orgColumn: schema.expense.organizationId, dateColumn: schema.expense.createdAt },
  bookings: { table: schema.booking, orgColumn: schema.booking.organizationId, dateColumn: schema.booking.createdAt },
  offeredSlots: { table: schema.offeredSlot, orgColumn: schema.offeredSlot.organizationId, dateColumn: schema.offeredSlot.offeredAt },
  caltodoTasks: { table: schema.caltodoTask, orgColumn: schema.caltodoTask.organizationId, dateColumn: schema.caltodoTask.createdAt },
  outboundDeliveries: { table: schema.outboundDelivery, orgColumn: schema.outboundDelivery.organizationId, dateColumn: schema.outboundDelivery.createdAt },
  mediaAssets: { table: schema.mediaAsset, orgColumn: schema.mediaAsset.organizationId, dateColumn: schema.mediaAsset.createdAt },
  agentTestRuns: { table: schema.agentTestRun, orgColumn: schema.agentTestRun.organizationId, dateColumn: schema.agentTestRun.startedAt },
  agentTestCases: { table: schema.agentTestCase, orgColumn: schema.agentTestCase.organizationId, dateColumn: schema.agentTestCase.createdAt },
  emailMessages: { table: schema.emailMessage, orgColumn: schema.emailMessage.organizationId, dateColumn: schema.emailMessage.createdAt },
};

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, deleteSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const { startDate, endDate, tables } = body.data;
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  let totalDeleted = 0;
  const results: Record<string, number> = {};

  for (const tableKey of tables) {
    const mapping = TABLE_MAP[tableKey];
    if (!mapping) continue;

    const where = and(
      scoped(mapping.orgColumn, session.organizationId),
      gte(mapping.dateColumn, start),
      lte(mapping.dateColumn, end)
    );

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(mapping.table)
      .where(where);

    const count = countResult?.count ?? 0;

    if (count > 0) {
      await db.delete(mapping.table).where(where);
    }

    results[tableKey] = count;
    totalDeleted += count;
  }

  return Response.json({
    deleted: totalDeleted,
    message: `${totalDeleted.toLocaleString()} registro${totalDeleted !== 1 ? "s" : ""} eliminado${totalDeleted !== 1 ? "s" : ""}`,
    results,
  });
});
