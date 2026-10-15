import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { markSourceTestResult } from "@/server/intel/credentials";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { verifySerpApi } from "@/server/intel/sources/serpapi-trends";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ serpapiKey: z.string().trim().min(1) });

/**
 * Prueba en vivo de SerpApi: consulta Google Trends "tecnología" en MX
 * y verifica que devuelva serie temporal. Guarda el resultado en
 * `serpapi_status` para el badge verde/rojo.
 */
export const POST = withOwner(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const result = await verifySerpApi(body.data.serpapiKey);
  await markSourceTestResult(session.organizationId, "serpapi", result.ok);
  if (!result.ok) {
    return apiError(422, "serpapi_test_failed", result.reason ?? "SerpApi rechazó la API key.");
  }
  return Response.json({ ok: true });
});
