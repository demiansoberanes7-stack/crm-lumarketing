import { zernioSignatureFrom } from "@/server/zernio";
import { getWhatsappZernioByAccount, zernioWhatsappEnabled, zernioWhatsappWebhookUrl } from "@/server/whatsapp/zernio-credentials";
import { whatsappZernioEvent, validWhatsappZernioSignature, ingestWhatsappZernio } from "@/server/whatsapp/zernio-ingest";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!zernioWhatsappEnabled()) return new Response(null, { status: 404 });
  const raw = await req.text();
  if (raw.length > 2_000_000) return new Response(null, { status: 413 });
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
  const { token } = await ctx.params;
  if (!creds || !zernioWhatsappWebhookUrl(creds.organizationId).endsWith(`/${token}`) || !validWhatsappZernioSignature(raw, zernioSignatureFrom(req.headers), creds.webhookSecret)) return new Response(null, { status: 401 });
  try { await ingestWhatsappZernio(parsed.data, creds); }
  catch { return Response.json({ error: "No se pudo procesar el evento" }, { status: 503 }); }
  return Response.json({ ok: true });
}
