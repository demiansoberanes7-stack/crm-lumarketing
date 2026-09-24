import { z } from "zod";
import { eq, sql, count } from "drizzle-orm";
import { parseBody, withAuth } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { chatJson, type ChatMessage } from "@/lib/ai";

export const dynamic = "force-dynamic";

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
});

/** Simple in-memory chat history per session (resets on deploy) */
const chatHistory = new Map<string, ChatMessage[]>();

async function getCrmContext(organizationId: string): Promise<string> {
  const db = getDb();
  const parts: string[] = [];

  // Contactos
  const [contactCount] = await db
    .select({ total: count() })
    .from(schema.contact)
    .where(scoped(schema.contact.organizationId, organizationId));
  parts.push(`Contactos totales: ${contactCount?.total ?? 0}`);

  // Leads por etapa
  const leadsByStage = await db
    .select({
      stage: schema.pipelineStage.name,
      total: count(),
    })
    .from(schema.lead)
    .innerJoin(schema.pipelineStage, eq(schema.lead.stageId, schema.pipelineStage.id))
    .where(scoped(schema.lead.organizationId, organizationId))
    .groupBy(schema.pipelineStage.name);
  if (leadsByStage.length > 0) {
    parts.push(`Leads por etapa: ${leadsByStage.map((r) => `${r.stage}(${r.total})`).join(", ")}`);
  }

  // Proyectos
  const [projectCount] = await db
    .select({ total: count() })
    .from(schema.project)
    .where(scoped(schema.project.organizationId, organizationId));
  const [archivedCount] = await db
    .select({ total: count() })
    .from(schema.project)
    .where(scoped(schema.project.organizationId, organizationId, sql`"${schema.project.archivedAt.name}" is not null`));
  parts.push(`Proyectos: ${projectCount?.total ?? 0} activos, ${archivedCount?.total ?? 0} archivados`);

  // Cotizaciones
  const [quoteCount] = await db
    .select({ total: count() })
    .from(schema.quote)
    .where(scoped(schema.quote.organizationId, organizationId));
  const [quoteTotal] = await db
    .select({ total: sql<number>`coalesce(sum("${schema.quote.total.name}"), 0)` })
    .from(schema.quote)
    .where(scoped(schema.quote.organizationId, organizationId));
  parts.push(`Cotizaciones: ${quoteCount?.total ?? 0}, monto total: $${((quoteTotal?.total ?? 0) / 100).toLocaleString("es-MX")}`);

  // Pagos recientes (30 dias)
  const [paymentCount] = await db
    .select({ total: count() })
    .from(schema.payment)
    .where(scoped(schema.payment.organizationId, organizationId));
  const [paymentTotal] = await db
    .select({ total: sql<number>`coalesce(sum("${schema.payment.monto.name}"), 0)` })
    .from(schema.payment)
    .where(scoped(schema.payment.organizationId, organizationId));
  parts.push(`Pagos: ${paymentCount?.total ?? 0}, total: $${((paymentTotal?.total ?? 0) / 100).toLocaleString("es-MX")}`);

  // Gastos
  const [expenseCount] = await db
    .select({ total: count() })
    .from(schema.expense)
    .where(scoped(schema.expense.organizationId, organizationId));
  const [expenseTotal] = await db
    .select({ total: sql<number>`coalesce(sum("${schema.expense.monto.name}"), 0)` })
    .from(schema.expense)
    .where(scoped(schema.expense.organizationId, organizationId));
  parts.push(`Gastos: ${expenseCount?.total ?? 0}, total: $${((expenseTotal?.total ?? 0) / 100).toLocaleString("es-MX")}`);

  // Tareas pendientes
  const [taskCount] = await db
    .select({ total: count() })
    .from(schema.caltodoTask)
    .where(scoped(schema.caltodoTask.organizationId, organizationId));
  parts.push(`Tareas pendientes: ${taskCount?.total ?? 0}`);

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

  const sessionId = session.organizationId;
  const history = chatHistory.get(sessionId) ?? [];

  // Fetch CRM data context
  const crmData = await getCrmContext(session.organizationId);

  const systemMessage: ChatMessage = {
    role: "system",
    content: `Eres un asistente interno del CRM. Tienes acceso a los siguientes datos del negocio:

${crmData}

Puedes responder preguntas sobre contactos, leads, pipeline, proyectos, cotizaciones, pagos, gastos y tareas. Usa los datos reales arriba para responder. Responde en espanol, se conciso y directo.`,
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
  history.push(userMessage, { role: "assistant", content: agentReply });
  if (history.length > 40) history.splice(0, history.length - 40);
  chatHistory.set(sessionId, history);

  return Response.json({
    response: agentReply,
    messages: [
      ...history.filter((m) => m.role !== "system").map((m) => ({
        role: m.role === "assistant" ? "agent" as const : "user" as const,
        text: m.content,
      })),
    ],
  });
});
