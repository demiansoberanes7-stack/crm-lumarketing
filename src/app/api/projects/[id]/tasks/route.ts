import { parseBody, withAuth } from "@/lib/api";
import { createTask, getProject } from "@/server/projects/service";
import { listAllTasks } from "@/server/projects/tasks";
import { ProjectError, projectErrorResponse } from "@/server/projects/errors";
import { createTaskSchema } from "@/lib/project-contract";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  try {
    if (!await getProject(session.organizationId, id)) throw new ProjectError(404, "Proyecto no encontrado");
    return Response.json({ tasks: await listAllTasks(session.organizationId, { projectId: id }) });
  } catch (error) { return projectErrorResponse(error); }
});

export const POST = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, createTaskSchema);
  if (!body.ok) return body.response;
  try {
    const taskId = await createTask(session.organizationId, id, {
      ...body.data,
      description: body.data.description ?? undefined,
      assigneeId: body.data.assigneeId ?? undefined,
      prioridad: body.data.prioridad ?? undefined,
      dueDate: body.data.dueDate ? new Date(body.data.dueDate) : undefined,
    });
    return Response.json({ ok: true, taskId }, { status: 201 });
  } catch (error) { return projectErrorResponse(error); }
});
