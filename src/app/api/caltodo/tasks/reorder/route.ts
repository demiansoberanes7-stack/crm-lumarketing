import { withAuth, parseBody, apiError } from "@/lib/api";
import { reorderCalTodoTasks } from "@/server/caltodo/store";
import { z } from "zod";
import { getCalTodoTasks } from "@/server/caltodo/store";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, z.object({ taskIds: z.array(z.string().min(1)).min(1).max(5000).refine((ids) => new Set(ids).size === ids.length, "IDs duplicados") }));
  if (!body.ok) return body.response;
  const tasks = await getCalTodoTasks(session.userId, session.organizationId);
  const pending = tasks.filter((t) => !t.completed);
  if (pending.length !== body.data.taskIds.length || body.data.taskIds.some((id) => !pending.some((t) => t.id === id))) return apiError(409, "stale_tasks", "La lista cambió. Actualiza e intenta de nuevo.");
  await reorderCalTodoTasks(body.data.taskIds, session.organizationId, session.userId);
  return Response.json({ ok: true });
});
