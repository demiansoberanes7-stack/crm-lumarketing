import { scheduleAgentTurn } from "@/server/ai/pipeline";
import { isAiConfigured } from "@/lib/env";
import { resolveAiConfig } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce).
 */
export async function maybeRunAgentTurn(
  conversationId: string
): Promise<void> {
  const db = getDb();
  const rows = await db.select({ organizationId: schema.conversation.organizationId }).from(schema.conversation).where(eq(schema.conversation.id, conversationId)).limit(1);
  if (!rows[0]) return;
  const aiConfig = await resolveAiConfig(rows[0].organizationId);
  if (!isAiConfigured(aiConfig.token)) return;
  scheduleAgentTurn(conversationId);
}
