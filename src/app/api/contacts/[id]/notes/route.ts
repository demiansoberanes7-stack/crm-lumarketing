import { desc, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const [contact] = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, session.organizationId, eq(schema.contact.id, id)))
    .limit(1);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");

  const notes = await db
    .select({
      id: schema.contactNote.id,
      body: schema.contactNote.body,
      source: schema.contactNote.source,
      createdBy: schema.contactNote.createdBy,
      createdAt: schema.contactNote.createdAt,
    })
    .from(schema.contactNote)
    .where(
      scoped(
        schema.contactNote.organizationId,
        session.organizationId,
        eq(schema.contactNote.contactId, id)
      )
    )
    .orderBy(desc(schema.contactNote.createdAt))
    .limit(100);
  return Response.json({ notes });
});
