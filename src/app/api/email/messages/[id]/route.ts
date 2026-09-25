import { withAuth, apiError } from "@/lib/api";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

type Params = { params: Promise<{ id: string }> };

export const PATCH = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const [message] = await getDb()
    .update(schema.emailMessage)
    .set({ seen: true })
    .where(
      scoped(
        schema.emailMessage.organizationId,
        session.organizationId,
        eq(schema.emailMessage.id, id)
      )
    )
    .returning({ id: schema.emailMessage.id });
  return message
    ? Response.json({ ok: true })
    : apiError(404, "not_found", "Correo no encontrado");
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const [deleted] = await db
    .delete(schema.emailMessage)
    .where(
      scoped(
        schema.emailMessage.organizationId,
        session.organizationId,
        eq(schema.emailMessage.id, id)
      )
    )
    .returning({ id: schema.emailMessage.id });
  return deleted
    ? Response.json({ ok: true })
    : apiError(404, "not_found", "Correo no encontrado");
});
