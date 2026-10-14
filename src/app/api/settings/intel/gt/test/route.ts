import { withOwner } from "@/lib/api";
import { markSourceTestResult } from "@/server/intel/credentials";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { verifyGt } from "@/server/intel/sources/google-trends";

export const dynamic = "force-dynamic";

/**
 * Prueba en vivo de Google Trends (endpoint no oficial): consulta
 * "tecnología" en MX para "now 1-m" y verifica que devuelva serie.
 * No requiere env var: GT es gratis y sin credenciales, el control es el
 * checkbox `gtEnabled` de la BD. Guarda el resultado en `gt_status`.
 */
export const POST = withOwner(async (session) => {
  if (!intelEnabled()) return intelDisabledResponse();

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
