import { eq, and, asc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { hasIdKind } from "@/lib/db/ids";
import { syncTaskById, taskEventIdFor, removeTaskEvent } from "@/server/agenda/tasks-sync";
import { nanoid } from "nanoid";

export type CalTodoTask = typeof schema.caltodoTask.$inferSelect;
export type CalTodoSettings = typeof schema.caltodoSettings.$inferSelect;

export async function getCalTodoSettings(userId: string, organizationId: string): Promise<CalTodoSettings | null> {
  const [row] = await getDb().select().from(schema.caltodoSettings)
    .where(and(scoped(schema.caltodoSettings.organizationId, organizationId), eq(schema.caltodoSettings.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function upsertCalTodoSettings(userId: string, organizationId: string, data: Partial<Pick<CalTodoSettings, "workStartHour" | "workEndHour" | "timezone" | "defaultDuration">>) {
  await getDb().insert(schema.caltodoSettings).values({ id: nanoid(), organizationId, userId, ...data })
    .onConflictDoUpdate({ target: [schema.caltodoSettings.organizationId, schema.caltodoSettings.userId], set: data });
}

export async function getCalTodoTasks(userId: string, organizationId: string): Promise<CalTodoTask[]> {
  const db = getDb();
  const calTodoTasks = await db.select().from(schema.caltodoTask)
    .where(and(scoped(schema.caltodoTask.organizationId, organizationId), eq(schema.caltodoTask.userId, userId)))
    .orderBy(asc(schema.caltodoTask.priority));

  const projectTasks = await db.select().from(schema.projectTask)
    .where(and(scoped(schema.projectTask.organizationId, organizationId), eq(schema.projectTask.assigneeId, userId)));

  const mappedProjectTasks: CalTodoTask[] = projectTasks.map(pt => ({
    id: pt.id,
    organizationId: pt.organizationId,
    userId: pt.assigneeId!,
    title: pt.title,
    details: pt.description,
    urgent: pt.priority === "alta",
    duration: 60,
    priority: 0,
    scheduledStart: pt.dueDate ?? null,
    scheduledEnd: null,
    completed: pt.estado === "terminado",
    completedAt: pt.estado === "terminado" ? pt.updatedAt : null,
    contactId: null,
    projectId: pt.projectId,
    googleEventId: pt.googleEventId,
    createdAt: pt.createdAt,
    updatedAt: pt.updatedAt,
  }));

  return [...calTodoTasks, ...mappedProjectTasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.priority - b.priority;
  });
}

export async function createCalTodoTask(userId: string, organizationId: string, data: { title: string; details?: string; urgent?: boolean; duration?: number; priority?: number; contactId?: string | null; projectId?: string | null }) {
  const [row] = await getDb().insert(schema.caltodoTask).values({
    id: nanoid(),
    organizationId,
    userId,
    contactId: data.contactId ?? null,
    projectId: data.projectId ?? null,
    title: data.title,
    details: data.details ?? null,
    urgent: data.urgent ?? false,
    duration: data.duration ?? null,
    priority: data.priority ?? 0,
  }).returning();
  if (row) await syncTaskById(organizationId, row.id);
  return row;
}

export async function updateCalTodoTask(taskId: string, organizationId: string, data: Partial<Pick<CalTodoTask, "completed" | "title" | "details" | "urgent" | "duration" | "scheduledStart" | "scheduledEnd" | "priority" | "contactId" | "projectId">>, userId: string) {
  const db = getDb();
  if (hasIdKind(taskId, "projectTask")) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.completed !== undefined) updates.estado = data.completed ? "terminado" : "pendiente";
    if (data.title !== undefined) updates.title = data.title;
    if (data.details !== undefined) updates.description = data.details;
    if (data.urgent !== undefined) updates.priority = data.urgent ? "alta" : "normal";
    if (data.scheduledStart !== undefined) updates.dueDate = data.scheduledStart;

    const [row] = await db.update(schema.projectTask).set(updates)
      .where(and(eq(schema.projectTask.id, taskId), scoped(schema.projectTask.organizationId, organizationId), eq(schema.projectTask.assigneeId, userId)))
      .returning({ id: schema.projectTask.id });
    if (row) await syncTaskById(organizationId, taskId);
    return row;
  }

  const updates: Record<string, unknown> = { ...data, updatedAt: new Date() };
  if (data.completed === true) updates.completedAt = new Date();
  if (data.completed === false) updates.completedAt = null;
  const [row] = await db.update(schema.caltodoTask).set(updates)
    .where(and(eq(schema.caltodoTask.id, taskId), scoped(schema.caltodoTask.organizationId, organizationId), eq(schema.caltodoTask.userId, userId)))
    .returning();
  if (row) await syncTaskById(organizationId, taskId);
  return row;
}

export async function deleteCalTodoTask(taskId: string, organizationId: string, userId: string) {
  const db = getDb();
  // El id de Google vive en la fila: se lee antes de borrarla y el evento se
  // retira solo si la tarea se borró de verdad.
  const googleEventId = await taskEventIdFor(organizationId, taskId);
  if (hasIdKind(taskId, "projectTask")) {
    const deleted = await db.delete(schema.projectTask).where(and(eq(schema.projectTask.id, taskId), scoped(schema.projectTask.organizationId, organizationId), eq(schema.projectTask.assigneeId, userId))).returning({ id: schema.projectTask.id });
    if (deleted.length) await removeTaskEvent(organizationId, googleEventId);
    return deleted.length > 0;
  }
  const deleted = await db.delete(schema.caltodoTask).where(and(eq(schema.caltodoTask.id, taskId), scoped(schema.caltodoTask.organizationId, organizationId), eq(schema.caltodoTask.userId, userId))).returning({ id: schema.caltodoTask.id });
  if (deleted.length) await removeTaskEvent(organizationId, googleEventId);
  return deleted.length > 0;
}

export async function reorderCalTodoTasks(taskIds: string[], organizationId: string, userId: string) {
  await getDb().transaction(async (tx) => {
    for (const [i, id] of taskIds.entries()) {
      // Project tasks are shown in Pendientes but have no independent rank column;
      // leave their project ordering intact and only rank native CalTodo tasks.
      if (hasIdKind(id, "projectTask")) continue;
      await tx.update(schema.caltodoTask).set({ priority: i, updatedAt: new Date() })
        .where(and(eq(schema.caltodoTask.id, id), scoped(schema.caltodoTask.organizationId, organizationId), eq(schema.caltodoTask.userId, userId)));
    }
  });
}
