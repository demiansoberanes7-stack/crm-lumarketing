import type { NextRequest } from "next/server";
import { readLimitedBody, requestClientKey } from "@/lib/http/body";
import { checkDistributedRateLimit, WEBHOOK_RATE_LIMIT } from "@/lib/rate-limit";
import { persistWahaPayload } from "@/server/webhooks/inbound-ingress";
import { safeDiagnosticText } from "@/server/diagnostics/redact";

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
  // Lee el stream una vez y conserva el JSON exacto para persistirlo antes del ACK.
  const { token } = await params;
  const rate = await checkDistributedRateLimit(
    `webhook:waha:${token}:${requestClientKey(req)}`,
    WEBHOOK_RATE_LIMIT
  );
  if (!rate.allowed) return new Response(null, { status: 429 });
  const rawBody = await readLimitedBody(req, 2_000_000);
  if (rawBody === null) return new Response(null, { status: 413 });
  try {
    JSON.parse(rawBody || "null");
  } catch {
    return Response.json({ ok: true });
  }

  // El 200 significa que el evento ya quedó durable en PostgreSQL; la ruta no
  // depende de que `after()` sobreviva al proceso.
  try {
    await persistWahaPayload(token, rawBody || "null");
  } catch (err) {
    console.error("[waha-webhook] no se pudo persistir el evento:", safeDiagnosticText(String(err)));
    return Response.json({ error: "persistence_failed" }, { status: 503 });
  }

  return Response.json({ ok: true });
}
