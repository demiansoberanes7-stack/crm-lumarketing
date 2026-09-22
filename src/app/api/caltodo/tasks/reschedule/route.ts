import { withAuth, apiError } from "@/lib/api";
import { getCalTodoTasks, getCalTodoSettings, updateCalTodoTask } from "@/server/caltodo/store";
import { rescheduleAll } from "@/server/caltodo/scheduler";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session) => {
  const tasks = await getCalTodoTasks(session.userId, session.organizationId);
  const settings = await getCalTodoSettings(session.userId, session.organizationId);
  const rescheduled = rescheduleAll(tasks, settings);
  if (rescheduled.length !== tasks.filter((t) => !t.completed).length) return apiError(422, "no_slot", "Hay tareas que no caben en la jornada. Ajusta su duración o el horario.");
  for (const r of rescheduled) {
    await updateCalTodoTask(r.id, session.organizationId, { scheduledStart: r.scheduledStart, scheduledEnd: r.scheduledEnd }, session.userId);
  }
  return Response.json({ ok: true, count: rescheduled.length });
});
