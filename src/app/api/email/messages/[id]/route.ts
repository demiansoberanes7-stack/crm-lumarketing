import { withAuth, apiError } from "@/lib/api";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
export const PATCH = withAuth(async (session, _req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const [message] = await getDb().update(schema.emailMessage).set({ seen: true }).where(scoped(schema.emailMessage.organizationId, session.organizationId, eq(schema.emailMessage.id, (await params).id))).returning({ id: schema.emailMessage.id });
  return message ? Response.json({ ok: true }) : apiError(404, "not_found", "Correo no encontrado");
});
