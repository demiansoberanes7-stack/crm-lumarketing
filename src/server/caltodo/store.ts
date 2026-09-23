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
  await getDb().insert(schema.caltodoSettings).values({ id: nanoid(), organizationId, userId, ...data })
    .onConflictDoUpdate({ target: [schema.caltodoSettings.organizationId, schema.caltodoSettings.userId], set: data });
}

export async function getCalTodoTasks(userId: string, organizationId: string): Promise<CalTodoTask[]> {
  return getDb().select().from(schema.caltodoTask)
    .where(and(scoped(schema.caltodoTask.organizationId, organizationId), eq(schema.caltodoTask.userId, userId)))
    .orderBy(asc(schema.caltodoTask.priority));
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
  return row;
}

export async function updateCalTodoTask(taskId: string, organizationId: string, data: Partial<Pick<CalTodoTask, "completed" | "title" | "details" | "urgent" | "duration" | "scheduledStart" | "scheduledEnd" | "priority" | "contactId" | "projectId">>, userId: string) {
  const updates: Record<string, unknown> = { ...data, updatedAt: new Date() };
  if (data.completed === true) updates.completedAt = new Date();
  if (data.completed === false) updates.completedAt = null;
  const [row] = await getDb().update(schema.caltodoTask).set(updates)
    .where(and(eq(schema.caltodoTask.id, taskId), scoped(schema.caltodoTask.organizationId, organizationId), eq(schema.caltodoTask.userId, userId)))
    .returning();
  return row;
}

export async function deleteCalTodoTask(taskId: string, organizationId: string, userId: string) {
  const deleted = await getDb().delete(schema.caltodoTask)
    .where(and(eq(schema.caltodoTask.id, taskId), scoped(schema.caltodoTask.organizationId, organizationId), eq(schema.caltodoTask.userId, userId))).returning({ id: schema.caltodoTask.id });
  return deleted.length > 0;
}

export async function reorderCalTodoTasks(taskIds: string[], organizationId: string, userId: string) {
  await getDb().transaction(async (tx) => {
    for (const [i, id] of taskIds.entries()) {
      await tx.update(schema.caltodoTask).set({ priority: i, updatedAt: new Date() })
        .where(and(eq(schema.caltodoTask.id, id), scoped(schema.caltodoTask.organizationId, organizationId), eq(schema.caltodoTask.userId, userId)));
    }
  });
}
