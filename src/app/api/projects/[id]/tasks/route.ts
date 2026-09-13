import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { listTasks, createTask } from "@/server/projects/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** GET — listar tareas del proyecto */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const tasks = await listTasks(session.organizationId, id);
  return Response.json({ tasks });
});

const postSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  prioridad: z.string().nullable().optional(),
  dueDate: z.string().datetime().optional(),
});

/** POST — crear tarea en proyecto */
export const POST = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const taskId = await createTask(session.organizationId, id, {
    title: body.data.title,
    description: body.data.description ?? undefined,
    assigneeId: body.data.assigneeId ?? undefined,
    prioridad: body.data.prioridad ?? undefined,
    dueDate: body.data.dueDate ? new Date(body.data.dueDate) : undefined,
  });

  return Response.json({ ok: true, taskId }, { status: 201 });
});
