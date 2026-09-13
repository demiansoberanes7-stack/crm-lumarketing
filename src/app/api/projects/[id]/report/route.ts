import { apiError, withAuth } from "@/lib/api";
import { getProjectReport } from "@/server/projects/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** GET — reporte integral de un proyecto */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const report = await getProjectReport(session.organizationId, id);
  if (!report) return apiError(404, "not_found", "Proyecto no encontrado");
  return Response.json({ report });
});
