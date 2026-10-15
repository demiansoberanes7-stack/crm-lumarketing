import { after } from "next/server";
import type { NextRequest } from "next/server";
import { handleWahaWebhook } from "@/server/waha/webhook";
import { readLimitedBody, requestClientKey } from "@/lib/http/body";
import { checkDistributedRateLimit, WEBHOOK_RATE_LIMIT } from "@/lib/rate-limit";

/**
 * Webhook público de WAHA (WhatsApp HTTP API).
 * POST /api/webhooks/waha/[token]
 *
 * WAHA envía eventos en formato:
 * { event: "message.any"|"message.ack"|"session.status", session: "default", payload: {...} }
 *
 * La URL secreta protege el endpoint (patrón ADR-001).
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  // El body se lee ANTES de after(): una vez enviada la respuesta el stream
  // del request ya no está disponible y request.json() fallaría en silencio
  // dentro del callback (perdería todos los eventos de WAHA).
  const { token } = await params;
  const rate = await checkDistributedRateLimit(
    `webhook:waha:${token}:${requestClientKey(req)}`,
    WEBHOOK_RATE_LIMIT
  );
  if (!rate.allowed) return new Response(null, { status: 429 });
  const rawBody = await readLimitedBody(req, 2_000_000);
  if (rawBody === null) return new Response(null, { status: 413 });
  const body = (() => {
    try {
      return JSON.parse(rawBody || "null");
    } catch {
      return null;
    }
  })();

  // Respondemos 200 siempre para que WAHA no reintente.
  // El procesamiento va en after().
  after(async () => {
    try {
      await handleWahaWebhook(body, { params: Promise.resolve({ token }) });
    } catch (err) {
      console.error("[waha-webhook] error:", err);
    }
  });

  return Response.json({ ok: true });
}
