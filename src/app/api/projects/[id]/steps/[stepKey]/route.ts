import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { saveProjectStep } from "@/server/projects/steps";
import { projectErrorResponse } from "@/server/projects/errors";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  data: z.record(z.unknown()).optional(),
  complete: z.boolean().optional(),
});

/** PUT — guardar borrador (`complete:false`) o completar un paso */
export const PUT = withAuth(async (session, req: Request, { params }) => {
  const { id, stepKey } = await params;
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  try {
    const result = await saveProjectStep(
      session.organizationId,
      id,
      stepKey,
      body.data.data ?? {},
      body.data.complete === true,
      session.userId
    );
    return Response.json(result);
  } catch (error) {
    return projectErrorResponse(error);
  }
});
