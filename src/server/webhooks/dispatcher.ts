/**
 * Outbound Webhook Dispatcher — envía webhooks con HMAC-SHA256 y reintentos.
 *
 * Cada organización puede configurar múltiples webhooks URL con eventos
 * específicos. El dispatcher firma cada payload con HMAC-SHA256 y registra
 * cada intento en la tabla de auditoría.
 */
import { eq, and, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret } from "@/lib/crypto";

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5000, 30000, 120000]; // 5s, 30s, 2min

/** Eventos disponibles para webhooks */
export type WebhookEvent =
  | "contact.created"
  | "contact.updated"
  | "lead.created"
  | "lead.stage_changed"
  | "conversation.created"
  | "conversation.updated"
  | "message.inbound"
  | "message.outbound"
  | "message.status"
  | "booking.created"
  | "booking.updated"
  | "waha.session_status"
  | "quote.created"
  | "quote.sent"
  | "quote.accepted"
  | "quote.rejected"
  | "payment.created"
  | "expense.created"
  | "balance.closed"
  | "project.created"
  | "project.stage_changed"
  | "email.received"
  | "email.sent";

/** Firma HMAC-SHA256 */
function signPayload(
  payload: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(payload);

  // Usar crypto.subtle para HMAC-SHA256
  return crypto.subtle
    .importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ])
    .then((key) => crypto.subtle.sign("HMAC", key, data))
    .then((sig) => {
      const arr = new Uint8Array(sig);
      return Array.from(arr)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    });
}

/** Enviar un webhook con reintentos */
async function deliverWebhook(
  webhook: typeof schema.outboundWebhook.$inferSelect,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  const deliveryId = newId("outboundDelivery");

  // Crear registro de entrega
  await db.insert(schema.outboundDelivery).values({
    id: deliveryId,
    organizationId: webhook.organizationId,
    webhookId: webhook.id,
    event,
    payload,
    status: "pending",
    attempts: 0,
  });

  // Preparar payload
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    organizationId: webhook.organizationId,
    data: payload,
  });

  // Firmar si hay secreto
  let signature: string | null = null;
  if (webhook.secretCipher && webhook.secretIv && webhook.secretTag) {
    const secret = decryptSecret({
      cipher: webhook.secretCipher,
      iv: webhook.secretIv,
      tag: webhook.secretTag,
    });
    signature = await signPayload(body, secret);
  }

  // Intentar entregar con reintentos
  let lastError: string | null = null;
  let lastStatusCode: number | null = null;

  for (let attempt = 0; attempt <= (webhook.maxRetries ?? MAX_RETRIES); attempt++) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Webhook-Event": event,
        "X-Webhook-Delivery": deliveryId,
      };
      if (signature) {
        headers["X-Webhook-Signature"] = `sha256=${signature}`;
      }

      const res = await fetch(webhook.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });

      lastStatusCode = res.status;

      if (res.ok) {
        // Entrega exitosa
        await db
          .update(schema.outboundDelivery)
          .set({
            status: "delivered",
            attempts: attempt + 1,
            lastStatusCode: res.status,
            deliveredAt: new Date(),
          })
          .where(eq(schema.outboundDelivery.id, deliveryId));

        return;
      }

      lastError = `HTTP ${res.status}: ${await res.text().catch(() => "")}`;
    } catch (err) {
      lastError = String(err);
    }

    // Esperar antes del siguiente intento
    if (attempt < (webhook.maxRetries ?? MAX_RETRIES)) {
      await new Promise((r) =>
        setTimeout(r, RETRY_DELAYS_MS[attempt] ?? 5000)
      );
    }
  }

  // Todos los intentos fallaron
  await db
    .update(schema.outboundDelivery)
    .set({
      status: "failed",
      attempts: (webhook.maxRetries ?? MAX_RETRIES) + 1,
      lastStatusCode,
      lastError,
    })
    .where(eq(schema.outboundDelivery.id, deliveryId));
}

/**
 * Publicar un evento a todos los webhooks suscritos de una organización.
 * Llamar después de cada cambio de estado relevante.
 */
export async function publishWebhook(
  organizationId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const db = getDb();

  // Buscar webhooks activos de la organización que escuchen este evento
  const webhooks = await db
    .select()
    .from(schema.outboundWebhook)
    .where(
      and(
        eq(schema.outboundWebhook.organizationId, organizationId),
        eq(schema.outboundWebhook.active, true)
      )
    );

  for (const webhook of webhooks) {
    const events = webhook.events as string[];
    if (events.includes(event) || events.includes("*")) {
      // Entrega en background (fire-and-forget)
      deliverWebhook(webhook, event, payload).catch((err) => {
        console.error(
          `[webhook] error entregando ${event} a ${webhook.url}:`,
          err
        );
      });
    }
  }
}

/**
 * Reintentar entregas fallidas programadas.
 * Ejecutar periódicamente (cron job o al arrancar el servidor).
 */
export async function retryPendingDeliveries(): Promise<void> {
  const db = getDb();
  const now = new Date();

  const pending = await db
    .select()
    .from(schema.outboundDelivery)
    .where(
      and(
        eq(schema.outboundDelivery.status, "pending"),
        lte(schema.outboundDelivery.nextRetryAt, now)
      )
    )
    .limit(50);

  for (const delivery of pending) {
    // Reintentar con el webhook original
    const webhooks = await db
      .select()
      .from(schema.outboundWebhook)
      .where(eq(schema.outboundWebhook.id, delivery.webhookId))
      .limit(1);

    const webhook = webhooks[0];
    if (!webhook || !webhook.active) {
      await db
        .update(schema.outboundDelivery)
        .set({ status: "skipped" })
        .where(eq(schema.outboundDelivery.id, delivery.id));
      continue;
    }

    await deliverWebhook(
      webhook,
      delivery.event as WebhookEvent,
      delivery.payload as Record<string, unknown>
    );
  }
}
