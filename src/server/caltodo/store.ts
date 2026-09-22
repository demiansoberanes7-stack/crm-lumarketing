import { eq, and, asc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
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
  const existing = await getCalTodoSettings(userId, organizationId);
  if (existing) {
    await getDb().update(schema.caltodoSettings).set(data).where(eq(schema.caltodoSettings.id, existing.id));
  } else {
    await getDb().insert(schema.caltodoSettings).values({ id: nanoid(), organizationId, userId, ...data });
  }
}

export async function getCalTodoTasks(userId: string, organizationId: string): Promise<CalTodoTask[]> {
  return getDb().select().from(schema.caltodoTask)
    .where(and(scoped(schema.caltodoTask.organizationId, organizationId), eq(schema.caltodoTask.userId, userId)))
    .orderBy(asc(schema.caltodoTask.priority));
}

export async function createCalTodoTask(userId: string, organizationId: string, data: { title: string; details?: string; urgent?: boolean; duration?: number }) {
  const [row] = await getDb().insert(schema.caltodoTask).values({
    id: nanoid(),
    organizationId,
    userId,
    title: data.title,
    details: data.details ?? null,
    urgent: data.urgent ?? false,
    duration: data.duration ?? null,
  }).returning();
  return row;
}

export async function updateCalTodoTask(taskId: string, organizationId: string, data: Partial<Pick<CalTodoTask, "completed" | "title" | "details" | "urgent" | "duration" | "scheduledStart" | "scheduledEnd" | "priority">>) {
  const updates: Record<string, unknown> = { ...data, updatedAt: new Date() };
  if (data.completed === true) updates.completedAt = new Date();
  if (data.completed === false) updates.completedAt = null;
  const [row] = await getDb().update(schema.caltodoTask).set(updates)
    .where(and(eq(schema.caltodoTask.id, taskId), scoped(schema.caltodoTask.organizationId, organizationId)))
    .returning();
  return row;
}

export async function deleteCalTodoTask(taskId: string, organizationId: string) {
  await getDb().delete(schema.caltodoTask)
    .where(and(eq(schema.caltodoTask.id, taskId), scoped(schema.caltodoTask.organizationId, organizationId)));
}

export async function reorderCalTodoTasks(taskIds: string[], organizationId: string) {
  const updates = taskIds.map((id, i) =>
    getDb().update(schema.caltodoTask).set({ priority: i, updatedAt: new Date() })
      .where(and(eq(schema.caltodoTask.id, id), scoped(schema.caltodoTask.organizationId, organizationId)))
  );
  await Promise.all(updates);
}
