import { withAuth, parseBody, apiError } from "@/lib/api";
import { reorderCalTodoTasks } from "@/server/caltodo/store";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, { taskIds: true } as never);
  if (!body.ok) return body.response;
  const data = (await req.json()) as { taskIds?: string[] };
  if (!data.taskIds || !Array.isArray(data.taskIds) || data.taskIds.length === 0) {
    return apiError(400, "missing_taskIds", "taskIds array required");
  }
  await reorderCalTodoTasks(data.taskIds, session.organizationId);
  return Response.json({ ok: true });
});
