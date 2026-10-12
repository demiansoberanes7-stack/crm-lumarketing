import { asc, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const db = getDb();

  const [conv] = await db
    .select()
    .from(schema.watsiConversation)
    .where(
      scoped(schema.watsiConversation.organizationId, session.organizationId, eq(schema.watsiConversation.id, id))
    )
    .limit(1);
  if (!conv || conv.userId !== session.userId) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }

  const messages = await db
    .select()
    .from(schema.watsiMessage)
    .where(eq(schema.watsiMessage.conversationId, id))
    .orderBy(asc(schema.watsiMessage.createdAt))
    .limit(200);

  return Response.json({
    conversation: { id: conv.id, title: conv.title },
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
  });
});

export const DELETE = withAuth(async (session, req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const db = getDb();
  // Mismo criterio que el GET: la conversación es del usuario que la creó.
  // Sin el filtro por userId, cualquier miembro de la organización podía
  // borrar el copiloto personal de otro.
  const deleted = await db
    .delete(schema.watsiConversation)
    .where(
      scoped(
        schema.watsiConversation.organizationId,
        session.organizationId,
        eq(schema.watsiConversation.id, id),
        eq(schema.watsiConversation.userId, session.userId)
      )
    )
    .returning({ id: schema.watsiConversation.id });
  if (deleted.length === 0) return apiError(404, "not_found", "Conversación no encontrada");
  return Response.json({ ok: true });
});
