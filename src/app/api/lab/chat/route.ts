import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { runAgentTurn } from "@/server/ai/pipeline";

export const dynamic = "force-dynamic";

/** POST — send a test message to the agent and return the response */
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

  // If no conversationId, create a new test conversation
  if (!convId) {
    // Create a synthetic test contact
    const contactId = newId("contact");
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId,
      name: "Chat de prueba",
      source: "test",
      waIdentity: `test_chat_${contactId}`,
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
    // Verify conversation belongs to this org
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
        { error: { code: "not_found", message: "Conversación no encontrada" } },
        { status: 404 }
      );
    }
  }

  // Insert inbound message
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

  // Run agent turn
  await runAgentTurn(convId);

  // Get all messages after the inbound to find the agent's response
  const messages = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, convId))
    .orderBy(asc(schema.message.createdAt));

  // Get the last outbound message (agent response)
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
