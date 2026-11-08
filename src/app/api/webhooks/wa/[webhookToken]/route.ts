import { getEnv } from "@/lib/env";
import {
  isValidSignature,
  isValidWebhookToken,
} from "@/server/inbox/webhook";
import { readLimitedBody, requestClientKey } from "@/lib/http/body";
import { checkDistributedRateLimit, WEBHOOK_RATE_LIMIT } from "@/lib/rate-limit";
import { persistMetaWhatsAppPayload } from "@/server/webhooks/inbound-ingress";
import { safeDiagnosticText } from "@/server/diagnostics/redact";

/**
 * Webhook público de WhatsApp (contrato webhook.md).
 * Capa 1: el segmento [webhookToken] debe coincidir (si no → 404 sin efectos).
 * Capa 2: firma x-hub-signature-256 solo si META_APP_SECRET está configurado.
 * El POST acusa recibo después de guardar cada subevento en la cola PostgreSQL.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function GET(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response(null, { status: 403 });
}

export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const rate = await checkDistributedRateLimit(
    `webhook:wa:${webhookToken}:${requestClientKey(req)}`,
    WEBHOOK_RATE_LIMIT
  );
  if (!rate.allowed) return new Response(null, { status: 429 });

  const rawBody = await readLimitedBody(req, 2_000_000);
  if (rawBody === null) return new Response(null, { status: 413 });
  const signature = req.headers.get("x-hub-signature-256");
  if (!isValidSignature(rawBody, signature, env.META_APP_SECRET)) {
    return new Response(null, { status: 401 });
  }

  try {
    JSON.parse(rawBody);
  } catch {
    // body ilegible: 200 igualmente (Meta reintenta y termina desactivando)
    return Response.json({ received: true });
  }

  try {
    await persistMetaWhatsAppPayload(rawBody);
  } catch (err) {
    console.error("[webhook] no se pudo persistir el evento:", safeDiagnosticText(String(err)));
    return Response.json({ error: "persistence_failed" }, { status: 503 });
  }

  return Response.json({ received: true });
}
