import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { sendText } from "@/server/inbox/send";
import { getIntegration } from "@/server/integrations";
import { findAutomationRule } from "@/server/automation-rules";
import { listEmailAccounts, sendEmail } from "@/server/email/service";

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
  const [conversation] = await db
    .select({ contactId: schema.contact.id, contactName: schema.contact.name, ficha: schema.contact.ficha })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.id, conversationId)))
    .limit(1);
  if (!conversation) return;

  const integration = await getIntegration(organizationId, "automation_rules");
  const rule = findAutomationRule(integration?.credentials?.rules, "followup-3d");
  const messageText = rule?.messageText ?? "Hola, espero que estés teniendo un excelente día. Solo quería dar seguimiento a nuestra conversación anterior. ¿Tienes alguna duda con la cotización?";

  if (rule?.channel === "email") {
    const ficha = conversation.ficha;
    const email = typeof ficha === "object" && ficha !== null && "email" in ficha && typeof ficha.email === "string"
      ? ficha.email.trim()
      : "";
    if (!email) throw new Error("El contacto no tiene un correo en su ficha");
    const account = (await listEmailAccounts(organizationId)).find((item) => item.enabled);
    if (!account) throw new Error("No hay una cuenta de correo activa para enviar seguimientos");
    await sendEmail(organizationId, account.id, {
      to: email,
      subject: `Seguimiento: ${conversation.contactName}`,
      text: messageText,
      contactId: conversation.contactId,
    });
    return;
  }

  // Directly send a simple text for retargeting.
  await sendText({
    conversationId,
    organizationId,
    text: messageText,
    aiGenerated: true
  });
}
