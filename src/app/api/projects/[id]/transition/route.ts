import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { transitionProject } from "@/server/projects/service";
import { projectErrorResponse } from "@/server/projects/errors";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  toStageId: z.string().min(1),
  complete: z.boolean().optional(),
  expectedStageId: z.string().min(1).optional(),
}).strict();

/** POST — transicionar proyecto a nueva etapa */
export const POST = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  try {
    const result = await transitionProject(
      session.organizationId,
      id,
      body.data.toStageId,
      session.userId,
      body.data.complete,
      body.data.expectedStageId
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return projectErrorResponse(err);
  }
});
