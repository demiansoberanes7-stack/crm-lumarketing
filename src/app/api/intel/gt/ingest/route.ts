import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled, gtEnabled } from "@/server/intel/flag";
import { runGtIngest } from "@/server/intel/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  termId: z.string().min(1),
  geo: z.string().length(2).default("MX"),
});

/**
 * Dispara la ingesta de Google Trends para un término (serie, regiones,
 * relacionados). Re-ejecutable: upsert por día. Si la bandera INTEL_GT está
 * apagada, responde 404 (la superficie no existe en esta instancia).
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  if (!gtEnabled()) return intelDisabledResponse();

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "invalid_body", "termId y geo requeridos");
  }

  const result = await runGtIngest(session.organizationId, parsed.data.termId, parsed.data.geo);
  if (!result.ok) {
    return apiError(422, "gt_source_failed", result.reason ?? "Google Trends no devolvió datos.");
  }
  return Response.json(result);
});
