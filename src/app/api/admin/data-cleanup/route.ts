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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TABLE_MAP: Record<string, { table: any; dateColumn: string }> = {
  messages: { table: schema.message, dateColumn: "createdAt" },
  conversations: { table: schema.conversation, dateColumn: "createdAt" },
  leads: { table: schema.lead, dateColumn: "createdAt" },
  leadStageEvents: { table: schema.leadStageEvent, dateColumn: "createdAt" },
  projects: { table: schema.project, dateColumn: "createdAt" },
  projectStageEvents: { table: schema.projectStageEvent, dateColumn: "createdAt" },
  projectTasks: { table: schema.projectTask, dateColumn: "createdAt" },
  quotes: { table: schema.quote, dateColumn: "createdAt" },
  quoteEvents: { table: schema.quoteEvent, dateColumn: "createdAt" },
  charges: { table: schema.charge, dateColumn: "createdAt" },
  payments: { table: schema.payment, dateColumn: "createdAt" },
  expenses: { table: schema.expense, dateColumn: "createdAt" },
  bookings: { table: schema.booking, dateColumn: "createdAt" },
  offeredSlots: { table: schema.offeredSlot, dateColumn: "offeredAt" },
  caltodoTasks: { table: schema.caltodoTask, dateColumn: "createdAt" },
  outboundDeliveries: { table: schema.outboundDelivery, dateColumn: "createdAt" },
  mediaAssets: { table: schema.mediaAsset, dateColumn: "createdAt" },
  agentTestRuns: { table: schema.agentTestRun, dateColumn: "startedAt" },
  agentTestCases: { table: schema.agentTestCase, dateColumn: "createdAt" },
  emailMessages: { table: schema.emailMessage, dateColumn: "createdAt" },
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

    const dateCol = sql.raw(`"${mapping.dateColumn}"`);
    const [result] = await db
      .delete(mapping.table)
      .where(
        and(
          scoped(mapping.table.organizationId, session.organizationId),
          gte(dateCol, start),
          lte(dateCol, end)
        )
      )
      .returning({ id: sql<string>`"id"` });

    const deleted = result ? 1 : 0;
    results[tableKey] = deleted;
    totalDeleted += deleted;
  }

  return Response.json({
    deleted: totalDeleted,
    message: `${totalDeleted} tabla${totalDeleted !== 1 ? "s" : ""} limpiada${totalDeleted !== 1 ? "s" : ""}`,
    results,
  });
});
