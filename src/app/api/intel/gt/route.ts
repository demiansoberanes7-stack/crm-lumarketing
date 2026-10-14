import { withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { getGtReport } from "@/server/intel/service";

export const dynamic = "force-dynamic";

/**
 * Reporte GT de un término. Lee de la BD lo que ya se ingirió; si GT no tiene
 * datos, devuelve fallback YouTube normalizado 0–100 (fuente declarada).
 * Query: `?termId=...` (requerido).
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const url = new URL(req.url);
  const termId = url.searchParams.get("termId");
  if (!termId) {
    return Response.json({ error: "termId requerido" }, { status: 400 });
  }
  const report = await getGtReport(session.organizationId, termId);
  if (!report) {
    return Response.json({ error: "Término no encontrado" }, { status: 404 });
  }
  return Response.json(report);
});
