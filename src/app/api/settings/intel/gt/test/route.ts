import { withOwner } from "@/lib/api";
import { markSourceTestResult } from "@/server/intel/credentials";
import { intelDisabledResponse, intelEnabled, gtEnabled } from "@/server/intel/flag";
import { verifyGt } from "@/server/intel/sources/google-trends";

export const dynamic = "force-dynamic";

/**
 * Prueba en vivo de Google Trends (endpoint no oficial): consulta
 * "tecnología" en MX para "now 7-d" y verifica que devuelva serie.
 * Guarda el resultado en `gt_status` para el badge verde/rojo.
 */
export const POST = withOwner(async (session) => {
  if (!intelEnabled()) return intelDisabledResponse();
  if (!gtEnabled()) return intelDisabledResponse();

  const result = await verifyGt("tecnología", "MX");
  await markSourceTestResult(session.organizationId, "gt", result.ok);
  if (!result.ok) {
    return Response.json(
      { ok: false, reason: result.reason ?? "Google Trends no respondió." },
      { status: 422 }
    );
  }
  return Response.json({ ok: true });
});
