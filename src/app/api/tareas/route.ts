import { apiError, withAuth } from "@/lib/api";
import { taskStateSchema } from "@/lib/project-contract";
import { listAllTasks } from "@/server/projects/tasks";

export const dynamic = "force-dynamic";
export const GET = withAuth(async (session, req: Request) => {
  const query = new URL(req.url).searchParams;
  const estado = query.get("estado") || undefined;
  if (estado && !taskStateSchema.safeParse(estado).success) return apiError(422, "invalid_state", "Estado de tarea no válido");
  return Response.json({ tasks: await listAllTasks(session.organizationId, {
    estado, projectId: query.get("projectId") || undefined, assigneeId: query.get("assigneeId") || undefined,
  }) });
});
