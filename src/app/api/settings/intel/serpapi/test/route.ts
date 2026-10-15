import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getIntelCredentials, markSourceTestResult } from "@/server/intel/credentials";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { verifySerpApi } from "@/server/intel/sources/serpapi-trends";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ serpapiKey: z.string().trim().min(1) });

/**
 * Prueba en vivo de SerpApi. Si el body trae una key enmascarada
 * ("····xxxx"), usa la guardada en BD; si trae una key nueva, la prueba
 * directamente. Guarda el resultado en `serpapi_status`.
 */
export const POST = withOwner(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const raw = body.data.serpapiKey;
  let apiKey = raw;
  if (raw.startsWith("····")) {
    // Key enmascarada: cargar la guardada
    const creds = await getIntelCredentials(session.organizationId);
    if (!creds?.serpapiKey) {
      return apiError(422, "serpapi_not_saved", "Guarda la API key antes de probar la conexión.");
    }
    apiKey = creds.serpapiKey;
  }

  const result = await verifySerpApi(apiKey);
  await markSourceTestResult(session.organizationId, "serpapi", result.ok);
  if (!result.ok) {
    return apiError(422, "serpapi_test_failed", result.reason ?? "SerpApi rechazó la API key.");
  }
  return Response.json({ ok: true });
});
