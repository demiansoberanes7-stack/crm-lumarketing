import { z } from "zod";
import { eq, sql, count, isNotNull } from "drizzle-orm";
import { parseBody, withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { chatJson, type ChatMessage } from "@/lib/ai";

export const dynamic = "force-dynamic";

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
});

async function getCrmContext(organizationId: string): Promise<string> {
  const db = getDb();
  const parts: string[] = [];

  try {
    const [contactCount] = await db
      .select({ total: count() })
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId));
    parts.push(`Contactos totales: ${contactCount?.total ?? 0}`);
  } catch { /* skip on error */ }

  try {
    const leadsByStage = await db
      .select({ stage: schema.pipelineStage.name, total: count() })
      .from(schema.lead)
      .innerJoin(schema.pipelineStage, eq(schema.lead.stageId, schema.pipelineStage.id))
      .where(scoped(schema.lead.organizationId, organizationId))
      .groupBy(schema.pipelineStage.name);
    if (leadsByStage.length > 0) {
      parts.push(`Leads por etapa: ${leadsByStage.map((r) => `${r.stage}(${r.total})`).join(", ")}`);
    }
  } catch { /* skip on error */ }

  try {
    const [activeProjectCount] = await db
      .select({ total: count() })
      .from(schema.project)
      .where(scoped(schema.project.organizationId, organizationId, sql`${schema.project.archivedAt} is null`));
    const [archivedCount] = await db
      .select({ total: count() })
      .from(schema.project)
      .where(scoped(schema.project.organizationId, organizationId, isNotNull(schema.project.archivedAt)));
    parts.push(`Proyectos: ${activeProjectCount?.total ?? 0} activos, ${archivedCount?.total ?? 0} archivados`);
  } catch { /* skip on error */ }

  try {
    const [quoteCount] = await db
      .select({ total: count() })
      .from(schema.quote)
      .where(scoped(schema.quote.organizationId, organizationId));
    const [quoteTotal] = await db
      .select({ total: sql<number>`coalesce(sum("total"), 0)` })
      .from(schema.quote)
      .where(scoped(schema.quote.organizationId, organizationId));
    parts.push(`Cotizaciones: ${quoteCount?.total ?? 0}, monto total: $${((quoteTotal?.total ?? 0) / 100).toLocaleString("es-MX")}`);
  } catch { /* skip on error */ }

  try {
    const [paymentCount] = await db
      .select({ total: count() })
      .from(schema.payment)
      .where(scoped(schema.payment.organizationId, organizationId));
    const [paymentTotal] = await db
      .select({ total: sql<number>`coalesce(sum("monto"), 0)` })
      .from(schema.payment)
      .where(scoped(schema.payment.organizationId, organizationId));
    parts.push(`Pagos: ${paymentCount?.total ?? 0}, total: $${((paymentTotal?.total ?? 0) / 100).toLocaleString("es-MX")}`);
  } catch { /* skip on error */ }

  try {
    const [expenseCount] = await db
      .select({ total: count() })
      .from(schema.expense)
      .where(scoped(schema.expense.organizationId, organizationId));
    const [expenseTotal] = await db
      .select({ total: sql<number>`coalesce(sum("monto"), 0)` })
      .from(schema.expense)
      .where(scoped(schema.expense.organizationId, organizationId));
    parts.push(`Gastos: ${expenseCount?.total ?? 0}, total: $${((expenseTotal?.total ?? 0) / 100).toLocaleString("es-MX")}`);
  } catch { /* skip on error */ }

  try {
    const [taskCount] = await db
      .select({ total: count() })
      .from(schema.caltodoTask)
      .where(scoped(schema.caltodoTask.organizationId, organizationId, sql`${schema.caltodoTask.completed} = false`));
    parts.push(`Tareas pendientes: ${taskCount?.total ?? 0}`);
  } catch { /* skip on error */ }

  return parts.join("\n");
}

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, chatSchema);
  if (!body.ok) return body.response;

  const env = getEnv();
  const apiKey = env.CHATBOT_API_TOKEN;
  const model = env.CHATBOT_MODEL;
  const baseUrl = env.CHATBOT_BASE_URL;

  if (!apiKey) {
    return Response.json(
      { error: { code: "not_configured", message: "CHATBOT_API_TOKEN no configurado" } },
      { status: 503 }
    );
  }

  const db = getDb();

  // Resolve or create conversation
  let conversationId = body.data.conversationId;
  if (!conversationId) {
    const [conv] = await db
      .insert(schema.chatbotConversation)
      .values({
        id: newId("chatbotConversation"),
        organizationId: session.organizationId,
        userId: session.userId,
      })
      .returning({ id: schema.chatbotConversation.id });
    conversationId = conv?.id;
    if (!conversationId) {
      return Response.json(
        { error: { code: "internal", message: "Error al crear conversacion" } },
        { status: 500 }
      );
    }
  } else {
    // Verify conversation belongs to this org+user
    const [existing] = await db
      .select({ id: schema.chatbotConversation.id })
      .from(schema.chatbotConversation)
      .where(
        scoped(
          schema.chatbotConversation.organizationId,
          session.organizationId,
          eq(schema.chatbotConversation.id, conversationId),
          eq(schema.chatbotConversation.userId, session.userId)
        )
      );
    if (!existing) {
      return Response.json(
        { error: { code: "not_found", message: "Conversacion no encontrada" } },
        { status: 404 }
      );
    }
  }

  // Load history from DB (last 20 messages)
  const dbMessages = await db
    .select({ role: schema.chatbotMessage.role, content: schema.chatbotMessage.content })
    .from(schema.chatbotMessage)
    .where(eq(schema.chatbotMessage.conversationId, conversationId))
    .orderBy(schema.chatbotMessage.createdAt);

  const history: ChatMessage[] = dbMessages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  let crmData = "Sin datos disponibles.";
  try {
    crmData = await getCrmContext(session.organizationId);
  } catch {
    // Fallback: chat without CRM data
  }

  const systemMessage: ChatMessage = {
    role: "system",
    content: `Eres un asistente interno del CRM llamado Lumark. Tienes acceso a los siguientes datos actualizados del negocio en tiempo real:

${crmData}

REGLAS OBLIGATORIAS:
- SIEMPRE responde con frases completas en español, nunca con solo un numero o palabra suelta.
- Usa los datos reales de arriba para responder. Si te preguntan por contactos, menciona el numero exacto.
- Si no tienes datos de algo, di "No tengo datos registrados de eso".
- Sé conciso pero amable. Maximo 2-3 oraciones por respuesta.`,
  };

  const userMessage: ChatMessage = { role: "user", content: body.data.message };
  const messages = [systemMessage, ...history.slice(-20), userMessage];

  const result = await chatJson(
    z.object({ response: z.string() }),
    [
      ...messages.slice(0, -1),
      { role: "user", content: `${body.data.message}\n\nResponde con JSON: {"response": "tu respuesta"}` },
    ],
    { apiKey, model, baseUrl, timeoutMs: 30_000 }
  );

  if (!result.ok) {
    return Response.json(
      { error: { code: "ai_error", message: result.detail } },
      { status: 502 }
    );
  }

  const agentReply = result.data.response;

  // Persist both messages to DB
  await db.insert(schema.chatbotMessage).values([
    { id: newId("chatbotMessage"), conversationId, role: "user", content: body.data.message },
    { id: newId("chatbotMessage"), conversationId, role: "assistant", content: agentReply },
  ]);

  // Update conversation timestamp
  await db
    .update(schema.chatbotConversation)
    .set({ updatedAt: new Date() })
    .where(eq(schema.chatbotConversation.id, conversationId));

  return Response.json({
    conversationId,
    response: agentReply,
    messages: [
      ...history.slice(-20).map((m) => ({
        role: m.role === "assistant" ? "agent" as const : "user" as const,
        text: m.content,
      })),
      { role: "user" as const, text: body.data.message },
      { role: "agent" as const, text: agentReply },
    ],
  });
});
