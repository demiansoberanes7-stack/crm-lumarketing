import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { transitionProject } from "@/server/projects/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

const postSchema = z.object({
  toStageId: z.string().min(1),
});

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
      session.userId
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return apiError(400, "transition_failed", String(err));
  }
});
