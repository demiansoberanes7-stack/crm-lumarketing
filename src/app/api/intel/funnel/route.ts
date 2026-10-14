import { withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { getCommercialFunnel } from "@/server/intel/funnel";

export const dynamic = "force-dynamic";

/**
 * Embudo comercial del CRM (reparto actual de leads por etapa + movimiento
 * de los últimos 90 días). Fuente: tablas propias lead/pipeline_stage/
 * lead_stage_event — sin terceros.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days") ?? "90");
  const windowDays =
    Number.isFinite(daysParam) && daysParam >= 7 && daysParam <= 365 ? daysParam : 90;
  const funnel = await getCommercialFunnel(session.organizationId, windowDays);
  return Response.json(funnel);
});
