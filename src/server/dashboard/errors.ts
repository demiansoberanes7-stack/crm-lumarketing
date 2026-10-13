import { desc, eq, gte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * Detalle de los contadores de "Infraestructura · Calidad".
 *
 * El dashboard solo cuenta; aquí se responde la pregunta que sigue: "¿A QUIÉN
 * le falló?" y "¿QUÉ evento de CAPI falló?". Cada lista trae los últimos
 * registros con error en la misma ventana de 24 h que usan los CTEs del
 * panel, con el destinatario (contacto) y el mensaje de error crudo.
 */

const DETAIL_LIMIT = 10;
const WINDOW_HOURS = 24;

export type ErrorDetailRow = {
  id: string;
  at: string;
  /** Quién o qué estaba en el otro extremo: contacto o recurso afectado. */
  subject: string;
  /** Segunda línea: canal/evento/regla context. */
  context: string;
  error: string;
};

function mapRows<T, R>(found: T[], map: (row: T) => R): R[] {
  return found.map(map);
}

function windowStart(): Date {
  return new Date(Date.now() - WINDOW_HOURS * 3_600_000);
}

/** Mensajes de texto/media que no se entregaron, con el contacto destinatario. */
export async function failedMessages(organizationId: string): Promise<ErrorDetailRow[]> {
  const db = getDb();
  const found = await db
    .select({
      id: schema.message.id,
      createdAt: schema.message.createdAt,
      error: schema.message.error,
      status: schema.message.status,
      direction: schema.message.direction,
      channel: schema.conversation.channel,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
    })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      eq(schema.conversation.id, schema.message.conversationId)
    )
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        gte(schema.message.createdAt, windowStart()),
        or(
          sql`${schema.message.error} is not null`,
          sql`${schema.message.status} in ('failed', 'error')`
        )
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(DETAIL_LIMIT);

  return mapRows(found, (m) => ({
    id: m.id,
    at: m.createdAt.toISOString(),
    subject: m.contactName,
    context: `${m.channel}${m.contactPhone ? ` · ${m.contactPhone}` : ""} · ${
      m.direction === "outbound" ? "saliente" : "entrante"
    } · ${m.status}`,
    error: m.error ?? "Error sin detalle",
  }));
}

/** Eventos de Conversions API rechazados por Meta, con el contacto origen. */
export async function failedConversions(organizationId: string): Promise<ErrorDetailRow[]> {
  const db = getDb();
  const found = await db
    .select({
      id: schema.conversionEvent.id,
      createdAt: schema.conversionEvent.createdAt,
      error: schema.conversionEvent.error,
      eventName: schema.conversionEvent.eventName,
      fbTraceId: schema.conversionEvent.fbTraceId,
      contactName: schema.contact.name,
    })
    .from(schema.conversionEvent)
    .innerJoin(
      schema.conversation,
      eq(schema.conversation.id, schema.conversionEvent.conversationId)
    )
    .leftJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.conversionEvent.organizationId,
        organizationId,
        gte(schema.conversionEvent.createdAt, windowStart()),
        or(
          sql`${schema.conversionEvent.error} is not null`,
          eq(schema.conversionEvent.status, "error")
        )
      )
    )
    .orderBy(desc(schema.conversionEvent.createdAt))
    .limit(DETAIL_LIMIT);

  return mapRows(found, (c) => ({
    id: c.id,
    at: c.createdAt.toISOString(),
    subject: c.contactName ?? "(contacto eliminado)",
    context: `evento ${c.eventName}${c.fbTraceId ? ` · trace ${c.fbTraceId}` : ""}`,
    error: c.error ?? "Error sin detalle",
  }));
}

/** Entregas webhooks fallidas, con el webhook y el código HTTP. */
export async function failedWebhooks(organizationId: string): Promise<ErrorDetailRow[]> {
  const db = getDb();
  const found = await db
    .select({
      id: schema.outboundDelivery.id,
      createdAt: schema.outboundDelivery.createdAt,
      lastError: schema.outboundDelivery.lastError,
      lastStatusCode: schema.outboundDelivery.lastStatusCode,
      event: schema.outboundDelivery.event,
      webhookName: schema.outboundWebhook.name,
      webhookUrl: schema.outboundWebhook.url,
    })
    .from(schema.outboundDelivery)
    .innerJoin(
      schema.outboundWebhook,
      eq(schema.outboundWebhook.id, schema.outboundDelivery.webhookId)
    )
    .where(
      scoped(
        schema.outboundDelivery.organizationId,
        organizationId,
        gte(schema.outboundDelivery.createdAt, windowStart()),
        or(
          eq(schema.outboundDelivery.status, "failed"),
          sql`${schema.outboundDelivery.lastError} is not null`
        )
      )
    )
    .orderBy(desc(schema.outboundDelivery.createdAt))
    .limit(DETAIL_LIMIT);

  return mapRows(found, (d) => ({
    id: d.id,
    at: d.createdAt.toISOString(),
    subject: d.webhookName,
    context: `${d.event} · ${d.webhookUrl}${
      d.lastStatusCode ? ` · HTTP ${d.lastStatusCode}` : ""
    }`,
    error: d.lastError ?? "Error sin detalle",
  }));
}

/** Ejecuciones de automatización que fallaron, con la regla y la conversación. */
export async function failedAutomations(organizationId: string): Promise<ErrorDetailRow[]> {
  const db = getDb();
  const found = await db
    .select({
      id: schema.automationExecution.id,
      createdAt: schema.automationExecution.createdAt,
      error: schema.automationExecution.error,
      status: schema.automationExecution.status,
      ruleId: schema.automationExecution.ruleId,
      channel: schema.conversation.channel,
      contactName: schema.contact.name,
    })
    .from(schema.automationExecution)
    .innerJoin(
      schema.conversation,
      eq(schema.conversation.id, schema.automationExecution.conversationId)
    )
    .leftJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.automationExecution.organizationId,
        organizationId,
        gte(schema.automationExecution.createdAt, windowStart()),
        or(
          sql`${schema.automationExecution.error} is not null`,
          eq(schema.automationExecution.status, "failed"),
          eq(schema.automationExecution.status, "error")
        )
      )
    )
    .orderBy(desc(schema.automationExecution.createdAt))
    .limit(DETAIL_LIMIT);

  return mapRows(found, (a) => ({
    id: a.id,
    at: a.createdAt.toISOString(),
    subject: a.contactName ?? "(conversación sin contacto)",
    context: `regla ${a.ruleId} · ${a.channel} · ${a.status}`,
    error: a.error ?? "Error sin detalle",
  }));
}

export type ErrorDetails = {
  messages: ErrorDetailRow[];
  capi: ErrorDetailRow[];
  webhooks: ErrorDetailRow[];
  automations: ErrorDetailRow[];
};

/** Los cuatro detalles en paralelo: una llamada para la tarjeta completa. */
export async function queryErrorDetails(organizationId: string): Promise<ErrorDetails> {
  const [messages, capi, webhooks, automations] = await Promise.all([
    failedMessages(organizationId),
    failedConversions(organizationId),
    failedWebhooks(organizationId),
    failedAutomations(organizationId),
  ]);
  return { messages, capi, webhooks, automations };
}
