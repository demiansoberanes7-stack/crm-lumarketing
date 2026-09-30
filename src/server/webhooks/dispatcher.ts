/**
 * Outbound Webhook Dispatcher — envía webhooks con HMAC-SHA256 y reintentos.
 *
 * Cada organización puede configurar múltiples webhooks URL con eventos
 * específicos. El dispatcher firma cada payload con HMAC-SHA256 y registra
 * cada intento en la tabla de auditoría.
 */
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret } from "@/lib/crypto";
import { recordDiagnostic } from "@/server/diagnostics/logger";
import { validateWebhookUrl } from "./url";

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5000, 30000, 120000]; // 5s, 30s, 2min

/** Eventos disponibles para webhooks */
export type WebhookEvent =
  | "contact.created"
  | "contact.updated"
  | "lead.created"
  | "lead.stage_changed"
  | "lead.amount_changed"
  | "lead.priority_changed"
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
  | "email.sent"
  /** Prueba manual desde Ajustes · Webhooks · "Probar envío". */
  | "webhook.test";

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

export type DeliveryResult = {
  deliveryId: string;
  ok: boolean;
  status: number | null;
  ms: number;
  attempts: number;
  error: string | null;
};

/**
 * Enviar un webhook con reintentos.
 *
 * `opts.maxRetries = 0` entrega un solo intento: es lo que usa el botón
 * "Probar envío" de Ajustes, donde esperar 2 minutos para ver un 500 no le
 * sirve a nadie.
 */
export async function deliverWebhook(
  webhook: typeof schema.outboundWebhook.$inferSelect,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  opts?: { maxRetries?: number }
): Promise<DeliveryResult> {
  const db = getDb();
  const deliveryId = newId("outboundDelivery");
  const startedAt = Date.now();
  const maxRetries = opts?.maxRetries ?? webhook.maxRetries ?? MAX_RETRIES;
  const done = (fields: Omit<DeliveryResult, "deliveryId" | "ms">): DeliveryResult => ({
    deliveryId,
    ms: Date.now() - startedAt,
    ...fields,
  });

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

  // Anti-SSRF: una URL que viola la política (sin HTTPS, IP privada, banda de
  // metadatos…) no lleva sentido reintentarla — falla el primer intento y ya.
  try {
    await validateWebhookUrl(webhook.url);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.outboundDelivery)
      .set({ status: "failed", attempts: 0, lastError: reason })
      .where(eq(schema.outboundDelivery.id, deliveryId));
    await recordDiagnostic({
      organizationId: webhook.organizationId,
      source: "webhook",
      code: "webhook_failed",
      severity: "warning",
      metadata: { webhookId: webhook.id, event, url: webhook.url, error: reason },
    });
    return done({ ok: false, status: null, attempts: 0, error: reason });
  }

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

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Webhook-Event": event,
        "X-Webhook-Delivery": deliveryId,
      };
      if (signature) {
        headers["X-Webhook-Signature"] = `sha256=${signature}`;
      }

      // `manual`: un 3xx no se sigue. Sin esto, un destino aparentemente
      // público podría redirigirnos a la red interna y burlar la validación.
      const res = await fetch(webhook.url, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
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

        return done({
          ok: true,
          status: res.status,
          attempts: attempt + 1,
          error: null,
        });
      }

      lastError = `HTTP ${res.status}: ${await res.text().catch(() => "")}`;
    } catch (err) {
      lastError = String(err);
    }

    // Esperar antes del siguiente intento
    if (attempt < maxRetries) {
      await new Promise((r) =>
        setTimeout(r, RETRY_DELAYS_MS[attempt] ?? 5000)
      );
    }
  }

  // Todos los intentos fallaron. `lastError` puede traer el cuerpo de la
  // respuesta remota: se trunca para que una fila de diagnóstico no arrastre
  // media página de HTML de un tercero.
  const error = lastError ? lastError.slice(0, 500) : null;
  const attempts = maxRetries + 1;
  await db
    .update(schema.outboundDelivery)
    .set({
      status: "failed",
      attempts,
      lastStatusCode,
      lastError: error,
    })
    .where(eq(schema.outboundDelivery.id, deliveryId));

  // Sin esto el fallo es mudo: la UI no tenía forma de enterarse de que la
  // integración del dueño lleva días rota.
  await recordDiagnostic({
    organizationId: webhook.organizationId,
    source: "webhook",
    code: "webhook_failed",
    severity: "warning",
    metadata: {
      webhookId: webhook.id,
      event,
      url: webhook.url,
      status: lastStatusCode,
      attempts,
      deliveryId,
      error,
    },
  });

  return done({ ok: false, status: lastStatusCode, attempts, error });
}

/**
 * Publicar un evento a todos los webhooks suscritos de una organización.
 *
 * Esta es la superficie que usan los 14 call sites (contacts, quotes, projects,
 * finances, agenda, inbox…) y es **síncrona a propósito**: nunca devuelve una
 * promesa rechazable. Antes era `async`, los 14 la llamaban sin `await` y
 * cualquier fallo terminaba como unhandledRejection que Next.js traga sin que
 * nadie se entere — la métrica de fallo se veía pero nadie sabía que había
 * fallos. Aquí el error se come, se loguea y se manda a diagnóstico.
 *
 * Usa `dispatchWebhooks` si necesitas esperar el resultado (tests).
 */
export function publishWebhook(
  organizationId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): void {
  void dispatchWebhooks(organizationId, event, payload).catch(async (err) => {
    console.error(`[webhook] error publicando ${event}:`, err);
    await recordDiagnostic({
      organizationId,
      source: "webhook",
      code: "webhook_failed",
      severity: "warning",
      metadata: {
        event,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      },
    });
  });
}

/** Igual que `publishWebhook`, pero esperable — para pruebas. */
export async function dispatchWebhooks(
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

  await Promise.all(
    webhooks.map((webhook) => {
      const events = webhook.events as string[];
      if (!events.includes(event) && !events.includes("*")) return null;
      // Entrega en background (fire-and-forget) con su propio `.catch`
      return deliverWebhook(webhook, event, payload).catch((err) => {
        console.error(
          `[webhook] error entregando ${event} a ${webhook.url}:`,
          err
        );
      });
    })
  );
}
