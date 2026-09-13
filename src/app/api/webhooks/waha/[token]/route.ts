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
  // Respondemos 200 siempre para que WAHA no reintente.
  // El procesamiento va en after().
  after(async () => {
    try {
      await handleWahaWebhook(req, { params });
    } catch (err) {
      console.error("[waha-webhook] error:", err);
    }
  });

  return Response.json({ ok: true });
}
