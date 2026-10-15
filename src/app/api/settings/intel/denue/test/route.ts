import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getIntelCredentials, markSourceTestResult } from "@/server/intel/credentials";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { queryEstablishments } from "@/server/intel/sources/denue";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  denueToken: z.string().trim().min(1),
  keyword: z.string().trim().min(1).max(200).optional(),
});

/**
 * Prueba en vivo del token DENUE: consulta el conteo de establecimientos
 * para la keyword indicada (o "tecnología" por defecto) en la entidad
 * "09" (CDMX). Si el token viene enmascarado ("····"), usa el guardado
 * en BD. Guarda el resultado en `denue_status` para el badge verde/rojo.
 */
export const POST = withOwner(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const raw = body.data.denueToken;
  let token = raw;
  if (raw.startsWith("····")) {
    const creds = await getIntelCredentials(session.organizationId);
    if (!creds?.denueToken) {
      return apiError(422, "denue_not_saved", "Guarda el token antes de probar la conexión.");
    }
    token = creds.denueToken;
  }

  const keyword = body.data.keyword?.trim() || "tecnología";
  const result = await queryEstablishments(token, [keyword], "09");
  await markSourceTestResult(session.organizationId, "denue", result.ok);
  if (!result.ok) {
    return apiError(422, "denue_test_failed", result.reason);
  }
  return Response.json({
    ok: true,
    count: result.count,
    censored: result.censored,
    keyword,
  });
});
