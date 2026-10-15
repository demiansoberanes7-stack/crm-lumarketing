import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { markSourceTestResult } from "@/server/intel/credentials";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { countEstablishments } from "@/server/intel/sources/denue";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  denueToken: z.string().trim().min(1),
  keyword: z.string().trim().min(1).max(200).optional(),
});

/**
 * Prueba en vivo del token DENUE: consulta el conteo de establecimientos
 * para la keyword indicada (o "tecnología" por defecto) en la entidad
 * "09" (CDMX). Guarda el resultado en `denue_status` para el badge verde/rojo.
 */
export const POST = withOwner(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const keyword = body.data.keyword?.trim() || "tecnología";
  const result = await countEstablishments(body.data.denueToken, [keyword], "09");
  const ok = result !== null;
  await markSourceTestResult(session.organizationId, "denue", ok);
  if (!ok) {
    return apiError(422, "denue_test_failed", "DENUE rechazó el token.");
  }
  return Response.json({
    ok: true,
    count: result?.count ?? 0,
    censored: result?.censored ?? false,
    keyword,
  });
});
