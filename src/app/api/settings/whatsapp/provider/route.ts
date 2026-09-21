import { z } from "zod";
import { withAuth, withOwner, parseBody, apiError } from "@/lib/api";
import { getWhatsappZernio, zernioWhatsappEnabled } from "@/server/whatsapp/zernio-credentials";
import { whatsappProvider, setWhatsappProvider } from "@/server/whatsapp/provider";
import { getWahaCredentialsFull } from "@/server/waha/credentials";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { recordDiagnostic } from "@/server/diagnostics/logger";

export const GET = withAuth(async (session) => Response.json({ provider: await whatsappProvider(session.organizationId), zernioEnabled: zernioWhatsappEnabled() }));
export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, z.object({ provider: z.enum(["meta", "waha", "zernio"]) }));
  if (!body.ok) return body.response;
  const creds = body.data.provider === "zernio" ? (zernioWhatsappEnabled() ? await getWhatsappZernio(session.organizationId) : null) : body.data.provider === "waha" ? await getWahaCredentialsFull(session.organizationId) : await getCredentialsByOrg(session.organizationId);
  if (!creds) return apiError(422, "not_configured", "Configura primero la conexión seleccionada.");
  await setWhatsappProvider(session.organizationId, body.data.provider);
  await recordDiagnostic({ organizationId: session.organizationId, source: body.data.provider, code: "provider_activated", severity: "info" });
  return Response.json({ ok: true, provider: body.data.provider });
});
