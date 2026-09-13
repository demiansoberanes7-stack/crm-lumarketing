import { apiError, withAuth } from "@/lib/api";
import { getProject } from "@/server/projects/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** GET — obtener proyecto con etapa actual */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const project = await getProject(session.organizationId, id);
  if (!project) return apiError(404, "not_found", "Proyecto no encontrado");
  return Response.json({ project });
});
