import { and, eq, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/**
 * Correos entrantes sin leer de la organización.
 *
 * El distintivo del ícono Mail de la bandeja lo consume: cuenta los mensajes
 * `direction='inbound'` con `seen=false` (los salientes entran `seen:true` al
 * enviarse, así que no inflan el contador). Se marca como leído el `PATCH` de
 * `/api/email/messages/[id]`, que el buzón dispara al abrir un hilo.
 */
export const GET = withAuth(async (session) => {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.emailMessage)
    .where(
      scoped(
        schema.emailMessage.organizationId,
        session.organizationId,
        and(
          eq(schema.emailMessage.direction, "inbound"),
          eq(schema.emailMessage.seen, false)
        )
      )
    );
  return Response.json({ unread: row?.count ?? 0 });
});
