import { getEnv } from "@/lib/env";
import { isValidSignature, isValidWebhookToken } from "@/server/inbox/webhook";
import {
  channelDisabledResponse,
  isChannelEnabled,
} from "@/server/channels/enabled";
import { isValidZernioSignature, looksLikeMetaPayload, zernioSignatureFrom } from "@/server/zernio";
import { resolveZernioSecret } from "@/server/zernio/dispatch";
import { readLimitedBody, requestClientKey } from "@/lib/http/body";
import { checkDistributedRateLimit, WEBHOOK_RATE_LIMIT } from "@/lib/rate-limit";
import { persistMetaMessengerPayload, persistZernioPayload } from "@/server/webhooks/inbound-ingress";
import { safeDiagnosticText } from "@/server/diagnostics/redact";

/**
 * 017 — Webhook público del canal de Messenger.
 *
 * Mismo patrón de dos capas que los de WhatsApp e Instagram: el segmento
 * [webhookToken] debe coincidir (si no → 404 sin efectos) y encima la firma.
 * Acepta las dos fuentes por la misma URL porque sus payloads son
 * inconfundibles: Meta manda `object: "page"`, Zernio manda un evento plano
 * con `account`.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!isChannelEnabled("messenger") && !isChannelEnabled("tiktok")) return channelDisabledResponse();
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  // Handshake de Meta (Zernio no lo hace, pero responderlo no estorba).
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
  if (!isChannelEnabled("messenger") && !isChannelEnabled("tiktok")) return channelDisabledResponse();
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }

  const rate = await checkDistributedRateLimit(
    `webhook:messenger:${webhookToken}:${requestClientKey(req)}`,
    WEBHOOK_RATE_LIMIT
  );
  if (!rate.allowed) return new Response(null, { status: 429 });

  const rawBody = await readLimitedBody(req, 2_000_000);
  if (rawBody === null) return new Response(null, { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Cuerpo ilegible: 200 igualmente para que la fuente no reintente en vano.
    return Response.json({ received: true });
  }

  const isMeta = looksLikeMetaPayload(payload, "page");

  if (isMeta) {
    // Meta firma cada entrega con el App Secret. Sin esta capa, quien conozca
    // la URL secreta puede inyectar mensajes falsos: el agente los contestaría
    // enviando un mensaje REAL desde la página al destinatario que el atacante
    // elija.
    if (
      !isValidSignature(
        rawBody,
        req.headers.get("x-hub-signature-256"),
        env.META_APP_SECRET
      )
    ) {
      return new Response(null, { status: 401 });
    }
  } else {
    // Zernio: la firma se valida contra el secreto de ESTA cuenta, que hay que
    // resolver leyendo el cuerpo primero.
    const resolved = await resolveZernioSecret(rawBody);
    if (!isValidZernioSignature(rawBody, zernioSignatureFrom(req.headers), resolved.secret)) {
      return new Response(null, { status: 401 });
    }
    try {
      await persistZernioPayload(rawBody, resolved);
    } catch (err) {
      console.error("[messenger] no se pudo persistir el evento:", safeDiagnosticText(String(err)));
      return Response.json({ error: "persistence_failed" }, { status: 503 });
    }
    return Response.json({ received: true });
  }

  try {
    await persistMetaMessengerPayload(rawBody);
  } catch (err) {
    console.error("[messenger] no se pudo persistir el evento:", safeDiagnosticText(String(err)));
    return Response.json({ error: "persistence_failed" }, { status: 503 });
  }

  return Response.json({ received: true });
}
