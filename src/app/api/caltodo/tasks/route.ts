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
  title: z.string().trim().min(1).max(200),
  details: z.string().max(5000).optional(),
  urgent: z.boolean().optional(),
  duration: z.number().int().min(15).max(480).optional(),
  contactId: z.string().max(255).nullable().optional(),
  projectId: z.string().max(255).nullable().optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  const settings = await getCalTodoSettings(session.userId, session.organizationId);
  const tasks = await getCalTodoTasks(session.userId, session.organizationId);
  const duration = body.data.duration ?? settings?.defaultDuration ?? 60;
  const slot = findNextFreeSlot(tasks, settings, duration);
  if (!slot) return apiError(422, "no_slot", "La duración no cabe en el horario laboral disponible");
  const priority = body.data.urgent ? Math.min(0, ...tasks.map((t) => t.priority)) - 1 : Math.max(-1, ...tasks.map((t) => t.priority)) + 1;
  const created = await createCalTodoTask(session.userId, session.organizationId, { ...body.data, priority });
  if (!created) return apiError(500, "create_failed", "No se pudo crear la tarea");
  if (slot) {
    await updateCalTodoTask(created.id, session.organizationId, { scheduledStart: slot.start, scheduledEnd: slot.end }, session.userId);
    created.scheduledStart = slot.start;
    created.scheduledEnd = slot.end;
  }
  return Response.json({ task: created });
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  details: z.string().max(5000).optional(),
  urgent: z.boolean().optional(),
  duration: z.number().int().min(15).max(480).optional(),
  completed: z.boolean().optional(),
  contactId: z.string().max(255).nullable().optional(),
  projectId: z.string().max(255).nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("id");
  if (!taskId) return apiError(400, "missing_id", "Task ID required");
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const tasks = await getCalTodoTasks(session.userId, session.organizationId);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return apiError(404, "not_found", "Tarea no encontrada");
  let schedule = {};
  if (body.data.duration !== undefined || body.data.completed === false) {
    const settings = await getCalTodoSettings(session.userId, session.organizationId);
    const slot = findNextFreeSlot(tasks.filter((t) => t.id !== taskId), settings, body.data.duration ?? task.duration ?? settings?.defaultDuration ?? 60);
    if (!slot) return apiError(422, "no_slot", "La duración no cabe en el horario laboral disponible");
    schedule = { scheduledStart: slot.start, scheduledEnd: slot.end };
  }
  const updated = await updateCalTodoTask(taskId, session.organizationId, { ...body.data, ...schedule }, session.userId);
  if (!updated) return apiError(404, "not_found", "Task not found");
  return Response.json({ task: updated });
});

export const DELETE = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("id");
  if (!taskId) return apiError(400, "missing_id", "Task ID required");
  if (!await deleteCalTodoTask(taskId, session.organizationId, session.userId)) return apiError(404, "not_found", "Tarea no encontrada");
  return Response.json({ ok: true });
});

export { PATCH as PUT } from "../settings/route";
