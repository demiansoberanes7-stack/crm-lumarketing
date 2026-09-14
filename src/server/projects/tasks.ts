import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { updateTaskSchema } from "@/lib/project-contract";
import { validateProjectMember } from "./members";
import { ProjectError } from "./errors";

export async function listAllTasks(organizationId: string, filters: { projectId?: string; assigneeId?: string; estado?: string } = {}) {
  const conditions = [scoped(schema.projectTask.organizationId, organizationId), scoped(schema.project.organizationId, organizationId)];
  if (filters.projectId) conditions.push(eq(schema.projectTask.projectId, filters.projectId));
  if (filters.assigneeId) conditions.push(eq(schema.projectTask.assigneeId, filters.assigneeId));
  if (filters.estado) conditions.push(eq(schema.projectTask.estado, filters.estado));
  return getDb().select({ ...getTableColumns(schema.projectTask), projectName: schema.project.name, assigneeName: schema.user.name })
    .from(schema.projectTask).innerJoin(schema.project, eq(schema.project.id, schema.projectTask.projectId))
    .leftJoin(schema.user, eq(schema.user.id, schema.projectTask.assigneeId))
    .where(and(...conditions)).orderBy(desc(schema.projectTask.createdAt));
}

export async function updateTask(organizationId: string, projectId: string, taskId: string, input: z.infer<typeof updateTaskSchema>) {
  await validateProjectMember(organizationId, input.assigneeId);
  const { prioridad, dueDate, ...fields } = input;
  const [task] = await getDb().update(schema.projectTask).set({
    ...fields, priority: prioridad, dueDate: dueDate === undefined ? undefined : dueDate === null ? null : new Date(dueDate), updatedAt: new Date(),
  }).where(scoped(schema.projectTask.organizationId, organizationId, eq(schema.projectTask.projectId, projectId), eq(schema.projectTask.id, taskId))).returning();
  if (!task) throw new ProjectError(404, "Tarea no encontrada en este proyecto");
  return task;
}

export async function deleteTask(organizationId: string, projectId: string, taskId: string) {
  const deleted = await getDb().delete(schema.projectTask)
    .where(scoped(schema.projectTask.organizationId, organizationId, eq(schema.projectTask.projectId, projectId), eq(schema.projectTask.id, taskId))).returning({ id: schema.projectTask.id });
  if (!deleted.length) throw new ProjectError(404, "Tarea no encontrada en este proyecto");
}
