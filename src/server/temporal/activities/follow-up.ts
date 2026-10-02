import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { sendText } from "@/server/inbox/send";
import { getIntegration } from "@/server/integrations";

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
  const db = getDb();
  const convs = await db.select().from(schema.conversation).where(eq(schema.conversation.id, conversationId)).limit(1);
  if (!convs[0]) return;

  const integration = await getIntegration(organizationId, "automation_rules");
  let messageText = "Hola, espero que estés teniendo un excelente día. Solo quería dar seguimiento a nuestra conversación anterior. ¿Tienes alguna duda con la cotización?";

  if (integration?.credentials?.rules) {
    const rules = integration.credentials.rules as any[];
    const rule = rules.find(r => r.id === "followup-3d");
    if (rule && rule.messageText) {
      messageText = rule.messageText;
    }
  }

  // Directly send a simple text for retargeting.
  await sendText({
    conversationId,
    organizationId,
    text: messageText,
    aiGenerated: true
  });
}
