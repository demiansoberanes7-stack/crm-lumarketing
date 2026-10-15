import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { markSourceTestResult } from "@/server/intel/credentials";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { verifyApify } from "@/server/intel/sources/apify-trends";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  apifyToken: z.string().trim().min(1),
  apifyActorId: z.string().trim().min(1).max(255),
});

/**
 * Prueba en vivo de Apify: verifica que el token sea válido y que el Actor
 * ID exista en la plataforma. No ejecuta el Actor (solo consulta metadatos).
 * Guarda el resultado en `apify_status` para el badge verde/rojo.
 */
export const POST = withOwner(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const result = await verifyApify(body.data.apifyToken, body.data.apifyActorId);
  await markSourceTestResult(session.organizationId, "apify", result.ok);
  if (!result.ok) {
    return apiError(422, "apify_test_failed", result.reason ?? "Apify rechazó el token o Actor ID.");
  }
  return Response.json({ ok: true });
});
