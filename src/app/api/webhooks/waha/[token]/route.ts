import { after } from "next/server";
import type { NextRequest } from "next/server";
import { handleWahaWebhook } from "@/server/waha/webhook";

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
  const body = await req.json().catch(() => null);

  // Respondemos 200 siempre para que WAHA no reintente.
  // El procesamiento va en after().
  after(async () => {
    try {
      await handleWahaWebhook(body, { params });
    } catch (err) {
      console.error("[waha-webhook] error:", err);
    }
  });

  return Response.json({ ok: true });
}
