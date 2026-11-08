import { zernioSignatureFrom } from "@/server/zernio";
import { getWhatsappZernioByAccount, zernioWhatsappEnabled, zernioWhatsappWebhookUrl } from "@/server/whatsapp/zernio-credentials";
import { whatsappZernioEvent, validWhatsappZernioSignature } from "@/server/whatsapp/zernio-ingest";
import { readLimitedBody, requestClientKey } from "@/lib/http/body";
import { checkDistributedRateLimit, WEBHOOK_RATE_LIMIT } from "@/lib/rate-limit";
import { persistZernioWhatsAppPayload } from "@/server/webhooks/inbound-ingress";
import { safeDiagnosticText } from "@/server/diagnostics/redact";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!zernioWhatsappEnabled()) return new Response(null, { status: 404 });
  const { token } = await ctx.params;
  const rate = await checkDistributedRateLimit(
    `webhook:zernio-wa:${token}:${requestClientKey(req)}`,
    WEBHOOK_RATE_LIMIT
  );
  if (!rate.allowed) return new Response(null, { status: 429 });
  const raw = await readLimitedBody(req, 2_000_000);
  if (raw === null) return new Response(null, { status: 413 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  // Eventos de plataforma de Zernio (ej. api.changelog.published): no traen
  // `account` ni `message`, no son mensajes. Se reconocen con 200 para que
  // Zernio no los marque como entregas fallidas, y se descartan sin procesar.
  const evt = (payload as { event?: unknown } | null)?.event;
  if (typeof evt === "string" && evt.startsWith("api.")) {
    return Response.json({ received: true, ignored: evt });
  }
  const parsed = whatsappZernioEvent.safeParse(payload);
  if (!parsed.success) return new Response(null, { status: 400 });
  const accountId = parsed.data.account.accountId ?? parsed.data.account.id;
  const creds = accountId ? await getWhatsappZernioByAccount(accountId) : null;
  if (!creds || !zernioWhatsappWebhookUrl(creds.organizationId).endsWith(`/${token}`) || !validWhatsappZernioSignature(raw, zernioSignatureFrom(req.headers), creds.webhookSecret)) return new Response(null, { status: 401 });
  try {
    await persistZernioWhatsAppPayload(raw, creds, parsed.data);
  } catch (error) {
    console.error("[zernio-whatsapp] no se pudo persistir el evento:", safeDiagnosticText(String(error)));
    return Response.json({ error: "No se pudo persistir el evento" }, { status: 503 });
  }
  return Response.json({ ok: true });
}
