import { parseBody, withAuth } from "@/lib/api";
import { updateTaskSchema } from "@/lib/project-contract";
import { updateTask, deleteTask } from "@/server/projects/tasks";
import { projectErrorResponse } from "@/server/projects/errors";

export const PATCH = withAuth(async (session, req: Request, { params }) => {
  const { id, taskId } = await params;
  const body = await parseBody(req, updateTaskSchema);
  if (!body.ok) return body.response;
  try {
    return Response.json({ task: await updateTask(session.organizationId, id, taskId, body.data) });
  } catch (error) { return projectErrorResponse(error); }
});

export const DELETE = withAuth(async (session, _req, { params }) => {
  const { id, taskId } = await params;
  try {
    await deleteTask(session.organizationId, id, taskId);
    return Response.json({ ok: true });
  } catch (error) { return projectErrorResponse(error); }
});
