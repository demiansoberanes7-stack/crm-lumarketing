/**
 * Projects Service — gestión de proyectos con pipeline de etapas.
 *
 * Avance por etapas completadas; 100% solo al terminar la última etapa,
 * reporte integral por proyecto, relación con contactos/conversaciones/cotizaciones.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { DEFAULT_PROJECT_STAGES } from "@/lib/project-contract";
import { ProjectError } from "./errors";
import { validateProjectMember } from "./members";

export type ProjectEstado = "activo" | "reunion" | "cerrado";
export type ProjectPrioridad = "alta" | "media" | "baja";
export type ProjectRiesgo = "bajo" | "medio" | "alto";

/** Generar código secuencial de proyecto (usa advisory lock para evitar race condition) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextProjectCode(db: any, organizationId: string): Promise<string> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${organizationId + ':projects'}))`);
  const last = await db
    .select({ code: schema.project.code })
    .from(schema.project)
    .where(scoped(schema.project.organizationId, organizationId))
    .orderBy(desc(schema.project.createdAt))
    .limit(1);

  if (last[0]) {
    const num = parseInt(last[0].code.replace("PRJ-", ""), 10);
    if (!isNaN(num)) {
      return `PRJ-${String(num + 1).padStart(4, "0")}`;
    }
  }
  return "PRJ-0001";
}

/** Crear proyecto nuevo */
export async function createProject(
  organizationId: string,
  input: {
    name: string;
    contactId?: string;
    service?: string;
    estado?: ProjectEstado;
    prioridad?: ProjectPrioridad;
    riesgo?: ProjectRiesgo;
    notas?: string;
    assignedUserId?: string;
  }
): Promise<string> {
  await validateProjectMember(organizationId, input.assignedUserId);
  if (input.contactId) {
    const [contact] = await getDb().select({ id: schema.contact.id }).from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, input.contactId))).limit(1);
    if (!contact) throw new ProjectError(422, "El contacto no pertenece a tu organización");
  }
  const stages = await getProjectStages(organizationId);
  return getDb().transaction(async (db) => {
  const id = newId("project");
  const code = await nextProjectCode(db, organizationId);

  await db.insert(schema.project).values({
    id,
    organizationId,
    code,
    name: input.name,
    contactId: input.contactId ?? null,
    service: input.service ?? null,
    estado: input.estado ?? "activo",
    avance: 0,
    stageId: stages[0]?.id,
    prioridad: input.prioridad ?? null,
    riesgo: input.riesgo ?? null,
    notas: input.notas ?? null,
    assignedUserId: input.assignedUserId ?? null,
  });

  return id;
  });
}

/** Obtener proyecto con etapa actual */
export async function getProject(organizationId: string, projectId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.project)
    .where(
      scoped(
        schema.project.organizationId,
        organizationId,
        eq(schema.project.id, projectId)
      )
    )
    .limit(1);

  if (!rows[0]) return null;
  const stages = await getProjectStages(organizationId);
  const currentStageIndex = Math.max(0, stages.findIndex((s) => s.id === rows[0]?.stageId));
  return { ...rows[0], currentStageIndex, stages };
}

/** Catálogo exclusivo de Proyectos; no modifica el pipeline comercial. */
export async function getProjectStages(organizationId: string) {
  const db = getDb();
  const existing = await db.select().from(schema.projectStage).where(scoped(schema.projectStage.organizationId, organizationId)).orderBy(schema.projectStage.position);
  if (existing.length === DEFAULT_PROJECT_STAGES.length) return existing;
  await db.insert(schema.projectStage).values(DEFAULT_PROJECT_STAGES.map((name, position) => ({
    id: `pst_${organizationId}_${position}`, organizationId, name, position,
  }))).onConflictDoNothing();
  return db.select().from(schema.projectStage).where(scoped(schema.projectStage.organizationId, organizationId)).orderBy(schema.projectStage.position);
}

/** Listar proyectos */
export async function listProjects(
  organizationId: string,
  opts?: { estado?: string; limit?: number; offset?: number }
) {
  const db = getDb();
  const conditions = [scoped(schema.project.organizationId, organizationId)];
  if (opts?.estado) {
    conditions.push(eq(schema.project.estado, opts.estado));
  }

  return db
    .select()
    .from(schema.project)
    .where(and(...conditions))
    .orderBy(desc(schema.project.updatedAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0);
}

/** Transicionar proyecto a nueva etapa */
export async function transitionProject(
  organizationId: string,
  projectId: string,
  toStageId: string,
  actorUserId?: string,
  complete = false,
  expectedStageId?: string
): Promise<{ changed: boolean }> {
  const allStages = await getProjectStages(organizationId);
  return getDb().transaction(async (db) => {
  const [project] = await db
    .select()
    .from(schema.project)
    .where(
      scoped(
        schema.project.organizationId,
        organizationId,
        eq(schema.project.id, projectId)
      )
    )
    .limit(1).for("update");

  if (!project) throw new ProjectError(404, "Proyecto no encontrado");
  if (expectedStageId && project.stageId !== expectedStageId) throw new ProjectError(409, "La etapa cambió. Actualiza el proyecto e inténtalo de nuevo");
  const targetStage = allStages.find((s) => s.id === toStageId);
  if (!targetStage) throw new ProjectError(422, "Etapa no válida para tu organización");
  const stageIndex = allStages.findIndex((s) => s.id === toStageId);
  if (complete && (stageIndex !== allStages.length - 1 || project.stageId !== toStageId)) throw new ProjectError(422, "Completa primero las etapas anteriores");
  if (project.stageId === toStageId && (project.estado === "cerrado") === complete) return { changed: false };
  const avance = complete ? 100 : Math.round(stageIndex / allStages.length * 100);

  // Actualizar proyecto
  await db
    .update(schema.project)
    .set({
      stageId: toStageId,
      avance,
      estado: complete ? "cerrado" : project.estado === "cerrado" ? "activo" : project.estado,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .where(scoped(schema.project.organizationId, organizationId, eq(schema.project.id, projectId)));

  // Registrar evento de transición
  await db.insert(schema.projectStageEvent).values({
    id: newId("projectStageEvent"),
    organizationId,
    projectId,
    fromStageId: project.stageId,
    fromStageName: allStages.find((s) => s.id === project.stageId)?.name ?? null,
    toStageId,
    toStageName: targetStage.name,
    actorUserId: actorUserId ?? null,
    source: complete ? "completado" : "dueno",
  });

  return { changed: true };
  });
}

/** Crear tarea para un proyecto */
export async function createTask(
  organizationId: string,
  projectId: string,
  input: {
    title: string;
    description?: string;
    assigneeId?: string;
    prioridad?: string;
    dueDate?: Date;
    estado?: "no_empezado" | "pendiente" | "terminado";
  }
): Promise<string> {
  const db = getDb();
  if (!await getProject(organizationId, projectId)) throw new ProjectError(404, "Proyecto no encontrado");
  await validateProjectMember(organizationId, input.assigneeId);
  const id = newId("projectTask");

  await db.insert(schema.projectTask).values({
    id,
    organizationId,
    projectId,
    title: input.title,
    description: input.description ?? null,
    assigneeId: input.assigneeId ?? null,
    priority: input.prioridad ?? null,
    estado: input.estado ?? "no_empezado",
    dueDate: input.dueDate ?? null,
  });

  return id;
}

/** Listar tareas de un proyecto */
export async function listTasks(organizationId: string, projectId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.projectTask)
    .where(
      and(
        scoped(schema.projectTask.organizationId, organizationId),
        eq(schema.projectTask.projectId, projectId)
      )
    )
    .orderBy(schema.projectTask.createdAt);
}

/** Obtener historial de etapas de un proyecto */
export async function getStageHistory(organizationId: string, projectId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.projectStageEvent)
    .where(
      and(
        scoped(schema.projectStageEvent.organizationId, organizationId),
        eq(schema.projectStageEvent.projectId, projectId)
      )
    )
    .orderBy(schema.projectStageEvent.createdAt);
}

/** Reporte integral de un proyecto */
export async function getProjectReport(organizationId: string, projectId: string) {
  const project = await getProject(organizationId, projectId);
  if (!project) return null;

  const [tasks, stageHistory] = await Promise.all([
    listTasks(organizationId, projectId),
    getStageHistory(organizationId, projectId),
  ]);

  // Obtener contacto relacionado
  let contact = null;
  if (project.contactId) {
    const db = getDb();
    const [c] = await db
      .select()
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, project.contactId)))
      .limit(1);
    contact = c ?? null;
  }

  return {
    project,
    contact,
    tasks,
    stageHistory,
    stats: {
      totalTasks: tasks.length,
      completed: tasks.filter((t) => t.estado === "terminado").length,
      pending: tasks.filter((t) => t.estado !== "terminado").length,
    },
  };
}
