import { z } from "zod";
import { parseBody, withOwner } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";

export const dynamic = "force-dynamic";

export const AVAILABLE_EVENTS = [
  "contact.created",
  "lead.created",
  "lead.stage_changed",
  "lead.amount_changed",
  "lead.priority_changed",
  "conversation.created",
  "message.inbound",
  "message.outbound",
  "quote.created",
  "quote.sent",
  "quote.accepted",
  "quote.rejected",
  "payment.created",
  "expense.created",
  "booking.created",
  "booking.updated",
  "project.created",
  "project.stage_changed",
] as const;

export type AvailableEvent = (typeof AVAILABLE_EVENTS)[number];

export const EVENT_LABELS: Record<AvailableEvent, string> = {
  "contact.created": "Contacto creado",
  "lead.created": "Lead creado",
  "lead.stage_changed": "Cambio de etapa en pipeline",
  "lead.amount_changed": "Cambio de monto en pipeline",
  "lead.priority_changed": "Cambio de prioridad",
  "conversation.created": "Conversación iniciada",
  "message.inbound": "Mensaje recibido",
  "message.outbound": "Mensaje enviado",
  "quote.created": "Cotización creada",
  "quote.sent": "Cotización enviada",
  "quote.accepted": "Cotización aceptada",
  "quote.rejected": "Cotización rechazada",
  "payment.created": "Pago registrado",
  "expense.created": "Gasto registrado",
  "booking.created": "Cita creada",
  "booking.updated": "Cita actualizada",
  "project.created": "Proyecto creado",
  "project.stage_changed": "Cambio de etapa en proyecto",
};

/** GET — listar webhooks de la organización */
export const GET = withOwner(async (session) => {
  const db = getDb();
  const webhooks = await db
    .select()
    .from(schema.outboundWebhook)
    .where(scoped(schema.outboundWebhook.organizationId, session.organizationId))
    .orderBy(schema.outboundWebhook.createdAt);

  return Response.json({
    webhooks: webhooks.map((w) => ({
      id: w.id,
      name: w.name,
      url: w.url,
      events: w.events,
      active: w.active,
      createdAt: w.createdAt,
    })),
    availableEvents: AVAILABLE_EVENTS,
    eventLabels: EVENT_LABELS,
  });
});

const postSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url().max(1024),
  secret: z.string().max(256).optional(),
  events: z.array(z.string()).min(1),
});

/** POST — crear webhook */
export const POST = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const id = newId("outboundWebhook");
  const db = getDb();

  // If secret provided, encrypt it
  let secretCipher: string | null = null;
  let secretIv: string | null = null;
  let secretTag: string | null = null;

  if (body.data.secret) {
    const { encryptSecret } = await import("@/lib/crypto");
    const enc = encryptSecret(body.data.secret);
    secretCipher = enc.cipher;
    secretIv = enc.iv;
    secretTag = enc.tag;
  }

  await db.insert(schema.outboundWebhook).values({
    id,
    organizationId: session.organizationId,
    name: body.data.name,
    url: body.data.url,
    secretCipher,
    secretIv,
    secretTag,
    events: body.data.events,
    active: true,
  });

  return Response.json({ ok: true, webhookId: id }, { status: 201 });
});
