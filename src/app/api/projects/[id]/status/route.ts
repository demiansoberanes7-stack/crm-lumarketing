import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { PROJECT_STATUSES } from "@/lib/project-types";
import { setProjectStatus } from "@/server/projects/steps";
import { projectErrorResponse } from "@/server/projects/errors";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  status: z.enum(PROJECT_STATUSES),
});

/** POST — cambiar el estado de workflow (finalizar, reabrir, cancelar…) */
export const POST = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  try {
    const result = await setProjectStatus(
      session.organizationId,
      id,
      body.data.status,
      session.userId
    );
    return Response.json(result);
  } catch (error) {
    return projectErrorResponse(error);
  }
});
