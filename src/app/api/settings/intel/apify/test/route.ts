import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getIntelCredentials, markSourceTestResult } from "@/server/intel/credentials";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { verifyApify } from "@/server/intel/sources/apify-trends";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  apifyToken: z.string().trim().min(1),
  apifyActorId: z.string().trim().min(1).max(255),
});

/**
 * Prueba en vivo de Apify: verifica token y Actor ID. Si el token viene
 * enmascarado, usa el guardado en BD. Guarda el resultado en `apify_status`.
 */
export const POST = withOwner(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  let token = body.data.apifyToken;
  if (token.startsWith("····")) {
    const creds = await getIntelCredentials(session.organizationId);
    if (!creds?.apifyToken) {
      return apiError(422, "apify_not_saved", "Guarda el token antes de probar la conexión.");
    }
    token = creds.apifyToken;
  }

  const result = await verifyApify(token, body.data.apifyActorId);
  await markSourceTestResult(session.organizationId, "apify", result.ok);
  if (!result.ok) {
    return apiError(422, "apify_test_failed", result.reason ?? "Apify rechazó el token o Actor ID.");
  }
  return Response.json({ ok: true });
});
