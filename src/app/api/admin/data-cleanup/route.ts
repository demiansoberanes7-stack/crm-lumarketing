import { z } from "zod";
import { gte, lte, and, sql } from "drizzle-orm";
import { parseBody, withOwner } from "@/lib/api";
import { getDb } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { TABLE_MAP } from "@/server/data-cleanup";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  tables: z.array(z.string().min(1)).min(1),
});

export const POST = withOwner(async (session, req: Request) => {
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
