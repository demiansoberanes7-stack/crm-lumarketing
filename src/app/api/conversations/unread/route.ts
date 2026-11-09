import { eq, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/**
 * Total de no-leídos en un solo `SUM`. El badge del menú y la campana solo
 * necesitan la cifra: antes se descargaba la lista entera de conversaciones
 * solo para sumarla en el cliente.
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select({
      unread: sql<number>`coalesce(sum(${schema.conversation.unreadCount}), 0)::int`,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        session.organizationId,
        eq(schema.conversation.isTest, false)
      )
    );
  return Response.json({ unread: rows[0]?.unread ?? 0 });
});
