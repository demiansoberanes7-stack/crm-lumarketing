import { z } from "zod";
import { gte, lte, and, sql } from "drizzle-orm";
import { parseBody, withOwner } from "@/lib/api";
import { getDb } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { TABLE_MAP } from "@/server/data-cleanup";

export const dynamic = "force-dynamic";

const previewSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  tables: z.array(z.string().min(1)).min(1),
});

export const POST = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, previewSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const { startDate, endDate, tables } = body.data;
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const counts: Record<string, number> = {};

  for (const tableKey of tables) {
    const mapping = TABLE_MAP[tableKey];
    if (!mapping) continue;

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(mapping.table)
      .where(
        and(
          scoped(mapping.orgColumn, session.organizationId),
          gte(mapping.dateColumn, start),
          lte(mapping.dateColumn, end)
        )
      );
    counts[tableKey] = result?.count ?? 0;
  }

  return Response.json({ counts });
});
