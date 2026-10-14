import { withAuth } from "@/lib/api";
import { intelDisabledResponse, intelEnabled } from "@/server/intel/flag";
import { getTrends } from "@/server/intel/service";

export const dynamic = "force-dynamic";

/** Estado 1: tarjetas de tendencias actuales del módulo. */
export const GET = withAuth(async (session) => {
  if (!intelEnabled()) return intelDisabledResponse();
  const data = await getTrends(session.organizationId);
  return Response.json(data);
});
