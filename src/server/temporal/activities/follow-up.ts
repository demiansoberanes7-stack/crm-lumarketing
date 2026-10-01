import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { runAgentTurn } from "@/server/ai/pipeline";
import { sendText } from "@/server/inbox/send";

/** 
 * Verifies if the lead has replied recently. 
 * Returns true if the client sent a message after the given timestamp.
 */
export async function hasClientRepliedSince(conversationId: string, sinceDateIso: string): Promise<boolean> {
  const db = getDb();
  const messages = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId));
    
  const sinceDate = new Date(sinceDateIso);
  const clientMessagesAfter = messages.filter(m => m.direction === "in" && m.createdAt > sinceDate);
  
  return clientMessagesAfter.length > 0;
}

/**
 * Invokes the AI agent to generate and send a follow up message, 
 * or directly sends a hardcoded follow up if configured.
 */
export async function triggerAiFollowUp(conversationId: string, organizationId: string): Promise<void> {
  // Option 1: Just trigger the agent turn so it can evaluate context and send something
  // In a real scenario we might inject a system message like "El cliente lleva X días sin contestar, haz seguimiento"
  // For now we will append an internal note and run the agent.
  
  const db = getDb();
  const convs = await db.select().from(schema.conversation).where(eq(schema.conversation.id, conversationId)).limit(1);
  if (!convs[0]) return;
  
  // Directly send a simple text for retargeting.
  await sendText({
    conversationId,
    organizationId,
    text: "¡Hola! Queríamos saber si tienes alguna duda adicional sobre nuestra cotización. ¡Estamos a la orden!",
    aiGenerated: true
  });
}
