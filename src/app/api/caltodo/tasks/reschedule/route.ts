import { withAuth } from "@/lib/api";
import { getCalTodoTasks, getCalTodoSettings, updateCalTodoTask } from "@/server/caltodo/store";
import { rescheduleAll } from "@/server/caltodo/scheduler";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session) => {
  const tasks = await getCalTodoTasks(session.userId, session.organizationId);
  const settings = await getCalTodoSettings(session.userId, session.organizationId);
  const rescheduled = rescheduleAll(tasks, settings);
  for (const r of rescheduled) {
    await updateCalTodoTask(r.id, session.organizationId, { scheduledStart: r.scheduledStart, scheduledEnd: r.scheduledEnd });
  }
  return Response.json({ ok: true, count: rescheduled.length });
});
