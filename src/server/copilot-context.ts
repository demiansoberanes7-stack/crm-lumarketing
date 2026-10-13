import { and, asc, desc, eq, gte, ne, sql } from "drizzle-orm";
import { enabledCopilotDataSources, COPILOT_DATA_SOURCES, type CopilotDataSource } from "@/lib/copilot-config";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { queryDashboard } from "@/server/dashboard/query";

export type CopilotSourceStatus = {
  key: CopilotDataSource;
  label: string;
  status: "available" | "empty" | "unavailable";
  asOf: string;
};

export type CopilotContext = {
  text: string;
  sources: CopilotSourceStatus[];
};

function redactPersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[correo oculto]")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[teléfono oculto]");
}

/**
 * Construye únicamente las fuentes habilitadas en Configuración → Copiloto.
 * Cada consulta queda en el tenant y cada fallo se devuelve como fuente no
 * disponible para que el modelo no trate un bloque parcial como el sistema
 * completo. Los registros son contexto, nunca instrucciones para el modelo.
 */
export async function buildCopilotContext(
  organizationId: string,
  settings: { accessMode: string; dataSources: unknown },
  question: string
): Promise<CopilotContext> {
  const db = getDb();
  const enabled = enabledCopilotDataSources(settings);
  const now = new Date();
  const parts: string[] = [];
  const sources: CopilotSourceStatus[] = [];
  const contactDetailsRequested = /tel[eé]fono|n[uú]mero|correo|email|ficha|datos de contacto/i.test(question);

  async function collect(
    key: CopilotDataSource,
    work: () => Promise<string>
  ): Promise<void> {
    if (!enabled.has(key)) return;
    const definition = COPILOT_DATA_SOURCES.find((source) => source.key === key)!;
    try {
      const content = await work();
      const nonEmpty = content.trim().length > 0;
      sources.push({ key, label: definition.label, status: nonEmpty ? "available" : "empty", asOf: now.toISOString() });
      parts.push(`FUENTE: ${definition.label}\nESTADO: ${nonEmpty ? "disponible" : "sin registros"}\n${content || "(sin registros para esta consulta)"}`);
    } catch {
      // No se filtran mensajes internos, SQL ni credenciales al prompt o al UI.
      sources.push({ key, label: definition.label, status: "unavailable", asOf: now.toISOString() });
      parts.push(`FUENTE: ${definition.label}\nESTADO: no disponible; no uses ni infieras datos de esta fuente.`);
    }
  }

  await collect("metrics", async () => {
    const d = await queryDashboard(organizationId, "30d", now);
    return [
      `Período: ${d.period}; corte UTC: ${now.toISOString()}`,
      `Ingresos cobrados: $${(d.payments.grossIncome / 100).toLocaleString("es-MX")} MXN (${d.payments.count} pagos)`,
      `Gastos: $${(d.expenses.total / 100).toLocaleString("es-MX")} MXN`,
      `Resultado neto: $${(d.profitability.netIncome / 100).toLocaleString("es-MX")} MXN`,
      `Cuentas por cobrar: $${(d.receivables.totalPending / 100).toLocaleString("es-MX")} MXN (${d.receivables.overdueCount} vencidas)`,
      `Cotizaciones: ${d.quotes.total} en el periodo, ${d.quotes.sent} enviadas, ${d.quotes.approved} aceptadas`,
      `Proyectos: ${d.projects.active} activos, ${d.projects.completed} terminados; tareas: ${d.tasks.pending} pendientes, ${d.tasks.overdue} vencidas`,
      `Contactos: ${d.contacts.total}; nuevos en periodo: ${d.contacts.newThisPeriod}; conversaciones activas: ${d.inbox.active}`,
    ].join("\n");
  });

  await collect("pipeline", async () => {
    const rows = await db
      .select({ stage: schema.pipelineStage.name, count: sql<number>`count(${schema.lead.id})::int` })
      .from(schema.pipelineStage)
      .leftJoin(schema.lead, and(
        eq(schema.lead.stageId, schema.pipelineStage.id),
        eq(schema.lead.organizationId, organizationId)
      ))
      .where(scoped(schema.pipelineStage.organizationId, organizationId))
      .groupBy(schema.pipelineStage.id, schema.pipelineStage.name, schema.pipelineStage.position)
      .orderBy(asc(schema.pipelineStage.position));
    return rows.map((row) => `${row.stage}: ${row.count} oportunidades`).join("\n");
  });

  await collect("contacts", async () => {
    const rows = await db
      .select({ id: schema.contact.id, name: schema.contact.name, phone: schema.contact.phone, email: schema.contact.ficha, createdAt: schema.contact.createdAt })
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId, sql`${schema.contact.archivedAt} IS NULL`))
      .orderBy(desc(schema.contact.updatedAt))
      .limit(8);
    return rows.map((row) => {
      const ficha = row.email && typeof row.email === "object" ? row.email as Record<string, unknown> : {};
      const details = contactDetailsRequested
        ? ` · teléfono ${row.phone ?? "sin teléfono"}${typeof ficha.email === "string" ? ` · correo ${ficha.email}` : ""}`
        : "";
      return `- ${row.name ?? "Contacto sin nombre"}${details} · alta ${row.createdAt.toISOString().slice(0, 10)}`;
    }).join("\n");
  });

  await collect("conversations", async () => {
    const conversations = await db
      .select({ id: schema.conversation.id, channel: schema.conversation.channel, name: schema.contact.name, updatedAt: schema.conversation.updatedAt })
      .from(schema.conversation)
      .innerJoin(schema.contact, and(
        eq(schema.contact.id, schema.conversation.contactId),
        eq(schema.contact.organizationId, organizationId)
      ))
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.isTest, false)))
      .orderBy(desc(schema.conversation.updatedAt))
      .limit(8);
    const items = await Promise.all(conversations.map(async (conversation) => {
      const [latest] = await db
        .select({ direction: schema.message.direction, text: schema.message.text, createdAt: schema.message.createdAt })
        .from(schema.message)
        .where(scoped(schema.message.organizationId, organizationId, eq(schema.message.conversationId, conversation.id)))
        .orderBy(desc(schema.message.createdAt))
        .limit(1);
      if (!latest) return `- ${conversation.name} (${conversation.channel}): sin mensajes`;
      const latestText = (latest.text ?? "[adjunto]").slice(0, 400);
      const safeText = contactDetailsRequested ? latestText : redactPersonalData(latestText);
      return `- ${conversation.name} (${conversation.channel}, ${latest.direction}, ${latest.createdAt.toISOString()}): ${safeText}`;
    }));
    return items.join("\n");
  });

  await collect("notes", async () => {
    const rows = await db
      .select({ contactName: schema.contact.name, body: schema.contactNote.body, source: schema.contactNote.source, createdAt: schema.contactNote.createdAt })
      .from(schema.contactNote)
      .innerJoin(schema.contact, and(
        eq(schema.contact.id, schema.contactNote.contactId),
        eq(schema.contact.organizationId, organizationId)
      ))
      .where(scoped(schema.contactNote.organizationId, organizationId))
      .orderBy(desc(schema.contactNote.createdAt))
      .limit(10);
    return rows.map((row) => `- ${row.createdAt.toISOString()} · ${row.contactName} · ${row.source}: ${row.body.slice(0, 500)}`).join("\n");
  });

  await collect("quotes", async () => {
    const rows = await db
      .select({ number: schema.quote.quoteNumber, status: schema.quote.status, total: schema.quote.total, currency: schema.quote.currency, contactName: schema.contact.name, createdAt: schema.quote.createdAt })
      .from(schema.quote)
      .leftJoin(schema.contact, and(
        eq(schema.contact.id, schema.quote.contactId),
        eq(schema.contact.organizationId, organizationId)
      ))
      .where(scoped(schema.quote.organizationId, organizationId, sql`${schema.quote.archivedAt} IS NULL`))
      .orderBy(desc(schema.quote.createdAt))
      .limit(10);
    return rows.map((row) => `- ${row.number} · ${row.status} · ${row.contactName ?? "sin contacto"} · ${(row.total / 100).toLocaleString("es-MX")} ${row.currency} · ${row.createdAt.toISOString().slice(0, 10)}`).join("\n");
  });

  await collect("agenda", async () => {
    const rows = await db
      .select({ startsAt: schema.booking.scheduledAt, status: schema.booking.status, contactName: schema.contact.name, meetingLink: schema.booking.meetingLink })
      .from(schema.booking)
      .leftJoin(schema.contact, and(
        eq(schema.contact.id, schema.booking.contactId),
        eq(schema.contact.organizationId, organizationId)
      ))
      .where(scoped(schema.booking.organizationId, organizationId,
        gte(schema.booking.scheduledAt, now),
        eq(schema.booking.status, "agendada"),
        eq(schema.booking.isTest, false)
      ))
      .orderBy(asc(schema.booking.scheduledAt))
      .limit(10);
    return rows.map((row) => `- ${row.startsAt.toISOString()} · ${row.contactName ?? "sin contacto"} · ${row.meetingLink ?? "enlace pendiente"}`).join("\n");
  });

  await collect("projects_tasks", async () => {
    const projects = await db
      .select({ name: schema.project.name, status: schema.project.estado, progress: schema.project.avance })
      .from(schema.project)
      .where(scoped(schema.project.organizationId, organizationId, sql`${schema.project.archivedAt} IS NULL`))
      .orderBy(desc(schema.project.updatedAt))
      .limit(8);
    const tasks = await db
      .select({ title: schema.projectTask.title, status: schema.projectTask.estado, dueDate: schema.projectTask.dueDate, projectName: schema.project.name })
      .from(schema.projectTask)
      .innerJoin(schema.project, and(
        eq(schema.project.id, schema.projectTask.projectId),
        eq(schema.project.organizationId, organizationId)
      ))
      .where(scoped(schema.projectTask.organizationId, organizationId,
        ne(schema.projectTask.estado, "terminado"),
        sql`${schema.project.archivedAt} IS NULL`
      ))
      .orderBy(asc(schema.projectTask.dueDate))
      .limit(10);
    return [
      "Proyectos:",
      ...(projects.map((row) => `- ${row.name}: ${row.status}, ${row.progress}%`)),
      "Tareas abiertas:",
      ...(tasks.map((row) => `- ${row.title} (${row.projectName}), ${row.status}, vence ${row.dueDate?.toISOString() ?? "sin fecha"}`)),
    ].join("\n");
  });

  await collect("finances", async () => {
    const charges = await db
      .select({ concept: schema.charge.concept, total: schema.charge.totalAmount, paid: schema.charge.paidAmount, dueDate: schema.charge.dueDate, status: schema.charge.status, contactName: schema.contact.name })
      .from(schema.charge)
      .leftJoin(schema.contact, and(
        eq(schema.contact.id, schema.charge.contactId),
        eq(schema.contact.organizationId, organizationId)
      ))
      .where(scoped(schema.charge.organizationId, organizationId, ne(schema.charge.status, "cancelado")))
      .orderBy(asc(schema.charge.dueDate))
      .limit(10);
    return charges.map((row) => `- ${row.concept} · ${row.contactName ?? "sin contacto"} · pendiente $${((row.total - row.paid) / 100).toLocaleString("es-MX")} MXN · ${row.status} · vence ${row.dueDate?.toISOString().slice(0, 10) ?? "sin fecha"}`).join("\n");
  });

  await collect("integrations", async () => {
    const integrations = await db
      .select({ provider: schema.integration.provider })
      .from(schema.integration)
      .where(scoped(schema.integration.organizationId, organizationId));
    const configured = new Set(integrations.map((integration) => integration.provider));
    const [calendar] = await db.select({ status: schema.googleCredentials.status }).from(schema.googleCredentials).where(scoped(schema.googleCredentials.organizationId, organizationId)).limit(1);
    const [business] = await db.select({ status: schema.googleBusinessCredentials.status }).from(schema.googleBusinessCredentials).where(scoped(schema.googleBusinessCredentials.organizationId, organizationId)).limit(1);
    const emailCount = await db.select({ count: sql<number>`count(*)::int` }).from(schema.emailAccount).where(scoped(schema.emailAccount.organizationId, organizationId, eq(schema.emailAccount.enabled, true)));
    return [
      ...["meta_ads", "google_ads", "ga4", "automation_rules"].map((provider) => `- ${provider}: ${configured.has(provider) ? "configuración guardada; no es prueba en vivo" : "sin configurar"}`),
      `- Google Calendar: ${calendar?.status ?? "sin configurar"}`,
      `- Google Business Profile: ${business?.status ?? "sin configurar"}`,
      `- Cuentas de correo habilitadas: ${emailCount[0]?.count ?? 0}`,
    ].join("\n");
  });

  await collect("system_docs", async () => [
    "El CRM es un monolito Next.js con API routes, servicios de negocio del servidor y PostgreSQL/Drizzle.",
    "La Bandeja unifica contactos/conversaciones; el Pipeline usa leads y etapas con historial transaccional.",
    "La IA de Bandeja es operativa; Copiloto es de consulta read-only y no envía mensajes ni cambia registros.",
    "Integraciones con estado 'configurado/credenciales guardadas' requieren una prueba en su formulario para confirmar conectividad real.",
  ].join("\n"));

  return {
    text: parts.join("\n\n"),
    sources,
  };
}
