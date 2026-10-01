import { withAuth } from "@/lib/api";
import { listProjectSteps } from "@/server/projects/steps";
import { projectErrorResponse } from "@/server/projects/errors";

export const dynamic = "force-dynamic";

/** GET — pasos del expediente (siembra el stepper del tipo si falta) */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  try {
    const result = await listProjectSteps(session.organizationId, id);
    return Response.json(result);
  } catch (error) {
    return projectErrorResponse(error);
  }
});
