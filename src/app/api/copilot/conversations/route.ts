import { desc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.copilotConversation)
    .where(
      scoped(schema.copilotConversation.organizationId, session.organizationId, eq(schema.copilotConversation.userId, session.userId))
    )
    .orderBy(desc(schema.copilotConversation.updatedAt))
    .limit(50);
  return Response.json({
    conversations: rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

export const POST = withAuth(async (session) => {
  const db = getDb();
  const id = newId("copilotConversation");
  await db.insert(schema.copilotConversation).values({
    id,
    organizationId: session.organizationId,
    userId: session.userId,
    title: "Nueva conversación",
  });
  return Response.json({ conversation: { id, title: "Nueva conversación" } }, { status: 201 });
});
