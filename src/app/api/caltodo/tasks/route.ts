import { z } from "zod";
import { withAuth, parseBody, apiError } from "@/lib/api";
import { getCalTodoTasks, createCalTodoTask, updateCalTodoTask, deleteCalTodoTask, getCalTodoSettings } from "@/server/caltodo/store";
import { findNextFreeSlot } from "@/server/caltodo/scheduler";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const tasks = await getCalTodoTasks(session.userId, session.organizationId);
  const settings = await getCalTodoSettings(session.userId, session.organizationId);
  return Response.json({ tasks, settings });
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  details: z.string().max(5000).optional(),
  urgent: z.boolean().optional(),
  duration: z.number().min(15).max(480).optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  const settings = await getCalTodoSettings(session.userId, session.organizationId);
  const tasks = await getCalTodoTasks(session.userId, session.organizationId);
  const duration = body.data.duration ?? settings?.defaultDuration ?? 60;
  const slot = findNextFreeSlot(tasks, settings, duration);
  const created = await createCalTodoTask(session.userId, session.organizationId, body.data);
  if (!created) return apiError(500, "create_failed", "No se pudo crear la tarea");
  if (slot) {
    await updateCalTodoTask(created.id, session.organizationId, { scheduledStart: slot.start, scheduledEnd: slot.end });
    created.scheduledStart = slot.start;
    created.scheduledEnd = slot.end;
  }
  return Response.json({ task: created });
});

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  details: z.string().max(5000).optional(),
  urgent: z.boolean().optional(),
  duration: z.number().min(15).max(480).optional(),
  completed: z.boolean().optional(),
});

export const PATCH = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("id");
  if (!taskId) return apiError(400, "missing_id", "Task ID required");
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const updated = await updateCalTodoTask(taskId, session.organizationId, body.data);
  if (!updated) return apiError(404, "not_found", "Task not found");
  return Response.json({ task: updated });
});

export const DELETE = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("id");
  if (!taskId) return apiError(400, "missing_id", "Task ID required");
  await deleteCalTodoTask(taskId, session.organizationId);
  return Response.json({ ok: true });
});

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, z.object({
    workStartHour: z.number().min(0).max(23).optional(),
    workEndHour: z.number().min(0).max(23).optional(),
    timezone: z.string().optional(),
    defaultDuration: z.number().min(15).max(480).optional(),
  }));
  if (!body.ok) return body.response;
  const { upsertCalTodoSettings } = await import("@/server/caltodo/store");
  await upsertCalTodoSettings(session.userId, session.organizationId, body.data);
  return Response.json({ ok: true });
});
