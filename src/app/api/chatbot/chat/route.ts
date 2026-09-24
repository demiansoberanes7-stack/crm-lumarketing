import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { runAgentTurn } from "@/server/ai/pipeline";

export const dynamic = "force-dynamic";

/** POST — send a message to the AI assistant and return the response */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(
    req,
    z.object({
      message: z.string().min(1).max(2000),
      conversationId: z.string().optional(),
    })
  );
  if (!body.ok) return body.response;

  const db = getDb();
  const organizationId = session.organizationId;
  const now = new Date();

  let convId = body.data.conversationId;

  if (!convId) {
    const contactId = newId("contact");
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId,
      name: "Chatbot",
      source: "chatbot",
      waIdentity: `chatbot_${contactId}`,
      archivedAt: now,
    });

    convId = newId("conversation");
    await db.insert(schema.conversation).values({
      id: convId,
      organizationId,
      contactId,
      isTest: true,
      aiEnabled: true,
      lastInboundAt: now,
      lastMessageAt: now,
    });
  } else {
    const convRows = await db
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.id, convId)
        )
      )
      .limit(1);
    if (!convRows[0]) {
      return Response.json(
        { error: { code: "not_found", message: "Conversacion no encontrada" } },
        { status: 404 }
      );
    }
  }

  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId,
    conversationId: convId,
    direction: "in",
    type: "text",
    text: body.data.message,
    status: "delivered",
    waTimestamp: now,
  });

  await db
    .update(schema.conversation)
    .set({ lastInboundAt: now, lastMessageAt: now, updatedAt: now })
    .where(eq(schema.conversation.id, convId));

  await runAgentTurn(convId);

  const messages = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, convId))
    .orderBy(asc(schema.message.createdAt));

  const lastOutbound = [...messages]
    .reverse()
    .find((m) => m.direction === "out" && m.text);

  return Response.json({
    conversationId: convId,
    response: lastOutbound?.text ?? "(sin respuesta)",
    messages: messages
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? "user" : "agent",
        text: m.text!,
        timestamp: m.createdAt?.toISOString(),
      })),
  });
});
