import { z } from "zod";
import { withOwner, parseBody, apiError } from "@/lib/api";
import { getWhatsappZernio, getWhatsappZernioByAccount, saveWhatsappZernio, zernioWhatsappEnabled, zernioWhatsappWebhookUrl } from "@/server/whatsapp/zernio-credentials";
import { zernioFetch } from "@/server/zernio";
import { MetaApiError } from "@/lib/meta/client";

export const GET = withOwner(async (session) => {
  if (!zernioWhatsappEnabled()) return apiError(404, "disabled", "WhatsApp Zernio desactivado");
  const creds = await getWhatsappZernio(session.organizationId);
  return Response.json({ connection: creds ? { accountId: creds.accountId, tokenLast4: creds.token.slice(-4), displayPhone: creds.displayPhone, hasWebhookSecret: true } : null, webhookUrl: zernioWhatsappWebhookUrl(session.organizationId) });
});
export const PUT = withOwner(async (session, req: Request) => {
  if (!zernioWhatsappEnabled()) return apiError(404, "disabled", "WhatsApp Zernio desactivado");
  const parsed = await parseBody(req, z.object({ accountId: z.string().trim().min(1).max(255), token: z.string().trim().max(2048).optional(), webhookSecret: z.string().trim().max(2048).optional(), testOnly: z.boolean().optional() }));
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;
  const previous = await getWhatsappZernio(session.organizationId);
  const sameAccount = previous?.accountId === input.accountId;
  const token = input.token || (sameAccount ? previous.token : "");
  const webhookSecret = input.webhookSecret || (sameAccount ? previous.webhookSecret : "");
  if (!token || !webhookSecret) return apiError(422, "missing_credentials", "Introduce la API key y el secreto de firma del webhook de Zernio");
  const assigned = await getWhatsappZernioByAccount(input.accountId);
  if (assigned && assigned.organizationId !== session.organizationId) return apiError(409, "account_in_use", "Esta cuenta ya está vinculada");
  try {
    const info = await zernioFetch(`/whatsapp/number-info?accountId=${encodeURIComponent(input.accountId)}`, { token }) as { phone?: { display_phone_number?: string; status?: string } };
    if (!info.phone?.display_phone_number || info.phone.status !== "CONNECTED") return apiError(422, "not_connected", "El número no está conectado en Zernio. Revisa la cuenta de WhatsApp en su panel.");
    if (!input.testOnly) await saveWhatsappZernio({ organizationId: session.organizationId, accountId: input.accountId, token, webhookSecret, displayPhone: info.phone.display_phone_number });
    return Response.json({ ok: true, displayPhone: info.phone.display_phone_number });
  } catch (err) {
    return apiError(422, "zernio_failed", err instanceof MetaApiError ? `No se pudo verificar el número en Zernio (HTTP ${err.status}). Revisa accountId, API key y permisos de WhatsApp.` : "No se pudo guardar la conexión Zernio");
  }
});
