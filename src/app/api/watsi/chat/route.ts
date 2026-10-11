import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { chatJson, type ChatMessage } from "@/lib/ai";
import { queryDashboard } from "@/server/dashboard/query";

export const dynamic = "force-dynamic";

const chatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  conversationId: z.string().optional(),
});

/** Agrega datos frescos del CRM para inyectar al copiloto. */
async function getCrmContext(orgId: string): Promise<string> {
  const db = getDb();
  const lines: string[] = [];

  // Métricas del dashboard (cacheado 60s)
  try {
    const d = await queryDashboard(orgId, "30d");
    lines.push(
      `MÉTRICAS (últimos 30 días):`,
      `- Ingresos: $${(d.payments.grossIncome / 100).toLocaleString("es-MX")} MXN (${d.payments.count} pagos)`,
      `- Gastos: $${(d.expenses.total / 100).toLocaleString("es-MX")} MXN`,
      `- Resultado: $${(d.profitability.netIncome / 100).toLocaleString("es-MX")} MXN (margen ${d.profitability.margin?.toFixed(1) ?? 0}%)`,
      `- Por cobrar: $${(d.receivables.totalPending / 100).toLocaleString("es-MX")} MXN (${d.receivables.overdueCount} vencidos)`,
      `- Cotizaciones: ${d.quotes.total} creadas, ${d.quotes.approved} aprobadas (${d.quotes.approvalRate?.toFixed(0) ?? 0}%)`,
      `- Proyectos: ${d.projects.active} activos, ${d.projects.completed} completados, ${d.projects.archived} archivados`,
      `- Tareas: ${d.tasks.total} total, ${d.tasks.pending} pendientes, ${d.tasks.overdue} vencidas, ${d.tasks.completed} completadas`,
      `- Contactos: ${d.contacts.total} total, ${d.contacts.newThisPeriod} nuevos en el período`,
      `- Conversaciones activas: ${d.inbox.active}`,
    );
  } catch {
    lines.push("(Métricas no disponibles)");
  }

  // Leads por etapa
  try {
    const stageCounts = await db
      .select({
        name: schema.pipelineStage.name,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.lead)
      .innerJoin(schema.pipelineStage, eq(schema.lead.stageId, schema.pipelineStage.id))
      .where(scoped(schema.lead.organizationId, orgId))
      .groupBy(schema.pipelineStage.name)
      .orderBy(desc(sql`count(*)`));
    if (stageCounts.length > 0) {
      lines.push("", "PIPELINE:");
      for (const s of stageCounts) lines.push(`- ${s.name}: ${s.count} leads`);
    }
  } catch {
    /* skip */
  }

  // Últimos contactos
  try {
    const recent = await db
      .select({ name: schema.contact.name, phone: schema.contact.phone, createdAt: schema.contact.createdAt })
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, orgId))
      .orderBy(desc(schema.contact.createdAt))
      .limit(5);
    if (recent.length > 0) {
      lines.push("", "ÚLTIMOS CONTACTOS:");
      for (const c of recent) lines.push(`- ${c.name} (${c.phone ?? "sin teléfono"}) — ${c.createdAt.toISOString().slice(0, 10)}`);
    }
  } catch {
    /* skip */
  }

  // Próximas citas
  try {
    const bookings = await db
      .select({ start: schema.booking.scheduledAt, status: schema.booking.status })
      .from(schema.booking)
      .where(scoped(schema.booking.organizationId, orgId))
      .orderBy(schema.booking.scheduledAt)
      .limit(5);
    if (bookings.length > 0) {
      lines.push("", "PRÓXIMAS CITAS:");
      for (const b of bookings) lines.push(`- ${b.start.toISOString().slice(0, 16).replace("T", " ")} (${b.status})`);
    }
  } catch {
    /* skip */
  }

  return lines.join("\n");
}

export const POST = withAuth(async (session, req: Request) => {
  const body = await chatSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(422, "invalid_body", "Mensaje inválido");

  const db = getDb();
  const { message, conversationId } = body.data;

  // Resolver o crear conversación
  let convId = conversationId;
  if (convId) {
    const [existing] = await db
      .select({ id: schema.watsiConversation.id })
      .from(schema.watsiConversation)
      .where(
        scoped(schema.watsiConversation.organizationId, session.organizationId, eq(schema.watsiConversation.id, convId))
      )
      .limit(1);
    if (!existing) return apiError(404, "not_found", "Conversación no encontrada");
  } else {
    convId = newId("watsiConversation");
    await db.insert(schema.watsiConversation).values({
      id: convId,
      organizationId: session.organizationId,
      userId: session.userId,
      title: message.slice(0, 60),
    });
  }

  // Guardar mensaje del usuario
  await db.insert(schema.watsiMessage).values({
    id: newId("watsiMessage"),
    organizationId: session.organizationId,
    conversationId: convId,
    role: "user",
    content: message,
  });

  // Historial
  const history = await db
    .select()
    .from(schema.watsiMessage)
    .where(eq(schema.watsiMessage.conversationId, convId))
    .orderBy(asc(schema.watsiMessage.createdAt))
    .limit(40);

  // Contexto CRM fresco
  const crmContext = await getCrmContext(session.organizationId);

  const systemPrompt = [
    "Eres watsi, el copiloto de IA del espacio de trabajo. Respondes preguntas sobre los datos del CRM: leads, conversaciones, citas, métricas, proyectos, tareas, cotizaciones, pagos y gastos.",
    "Respondes SIEMPRE en español neutro, con mensajes claros y concisos (2-4 oraciones máximo).",
    "Usa EXCLUSIVAMENTE los datos que te doy abajo. Si un dato no está en el contexto, di claramente que no tienes esa información.",
    "Cuando te pidan un número, da el número exacto. No redondees ni inventes.",
    "Puedes hacer comparaciones, resúmenes y tendencias basándote en los datos disponibles.",
    "",
    "DATOS ACTUALES DEL CRM:",
    crmContext || "(Sin datos disponibles)",
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: message },
  ];

  const result = await chatJson(
    z.object({ response: z.string() }),
    messages,
    { timeoutMs: 30_000 }
  );

  const reply = result.ok
    ? result.data.response
    : result.error === "not_configured"
      ? "No tengo configurado un modelo de IA. Configura OPENROUTER_API_TOKEN en el entorno para usarme."
      : "No pude procesar tu pregunta en este momento. Intenta de nuevo.";

  // Guardar respuesta
  await db.insert(schema.watsiMessage).values({
    id: newId("watsiMessage"),
    organizationId: session.organizationId,
    conversationId: convId,
    role: "assistant",
    content: reply,
  });

  // Actualizar timestamp de la conversación
  await db
    .update(schema.watsiConversation)
    .set({ updatedAt: new Date() })
    .where(eq(schema.watsiConversation.id, convId));

  return Response.json({ conversationId: convId, response: reply });
});
