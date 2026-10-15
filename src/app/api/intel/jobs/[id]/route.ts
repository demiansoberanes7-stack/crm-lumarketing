import { apiError, withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { getIntelJob, serializeIntelJob } from "@/server/intel/jobs";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Estado y avance de un job de ingesta INTEL (para el sondeo de la UI). */
export const GET = withAuth(async (session, _req: Request, { params }: Params) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const { id } = await params;
  const job = await getIntelJob(session.organizationId, id);
  if (!job) return apiError(404, "not_found", "Job no encontrado");
  return Response.json({ job: serializeIntelJob(job) });
});
