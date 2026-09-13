/**
 * Projects Service — gestión de proyectos con pipeline de etapas.
 *
 * Tabla + Kanban, avance calculado como index/(n-1), 7 etapas predefinidas,
 * reporte integral por proyecto, relación con contactos/conversaciones/cotizaciones.
 */
import { eq, and, desc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export type ProjectEstado = "activo" | "reunion" | "cerrado";
export type ProjectPrioridad = "alta" | "media" | "baja";
export type ProjectRiesgo = "bajo" | "medio" | "alto";

/** Las 7 etapas predefinidas del pipeline de proyectos LUMARK */
export const PROJECT_STAGES = [
  { slug: "activacion", name: "1. Activación", order: 1 },
  { slug: "diagnostico", name: "2. Diagnóstico", order: 2 },
  { slug: "calendario", name: "3. Calendario de Contenido", order: 3 },
  { slug: "creacion", name: "4. Creación de Contenido", order: 4 },
  { slug: "campana", name: "5. Campaña", order: 5 },
  { slug: "reporte", name: "6. Reporte de Resultados", order: 6 },
  { slug: "renovacion", name: "7. Renovación", order: 7 },
];

/** Generar código secuencial de proyecto */
async function nextProjectCode(organizationId: string): Promise<string> {
  const db = getDb();
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
  const db = getDb();
  const id = newId("project");
  const code = await nextProjectCode(organizationId);

  await db.insert(schema.project).values({
    id,
    organizationId,
    code,
    name: input.name,
    contactId: input.contactId ?? null,
    service: input.service ?? null,
    estado: input.estado ?? "activo",
    avance: 0,
    prioridad: input.prioridad ?? null,
    riesgo: input.riesgo ?? null,
    notas: input.notas ?? null,
    assignedUserId: input.assignedUserId ?? null,
  });

  return id;
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

  return rows[0] ? { ...rows[0], currentStageIndex: Math.round(rows[0].avance * 6 / 100) } : null;
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
  actorUserId?: string
): Promise<{ changed: boolean }> {
  const db = getDb();

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
    .limit(1);

  if (!project) throw new Error("Proyecto no encontrado");

  // Obtener info de la etapa destino
  const [targetStage] = await db
    .select()
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.id, toStageId))
    .limit(1);

  if (!targetStage) throw new Error("Etapa no encontrada");

  // Calcular avance basado en posición
  const allStages = await db
    .select()
    .from(schema.pipelineStage)
    .where(
      scoped(schema.pipelineStage.organizationId, organizationId)
    )
    .orderBy(schema.pipelineStage.position);

  const stageIndex = allStages.findIndex((s) => s.id === toStageId);
  const avance = allStages.length > 1
    ? Math.round((stageIndex / (allStages.length - 1)) * 100)
    : 0;

  // Actualizar proyecto
  await db
    .update(schema.project)
    .set({
      stageId: toStageId,
      avance,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.project.id, projectId));

  // Registrar evento de transición
  await db.insert(schema.projectStageEvent).values({
    id: newId("projectStageEvent"),
    organizationId,
    projectId,
    fromStageId: project.stageId,
    fromStageName: null, // Se obtendría del stage anterior
    toStageId,
    toStageName: targetStage.name,
    actorUserId: actorUserId ?? null,
    source: "dueno",
  });

  return { changed: true };
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
  }
): Promise<string> {
  const db = getDb();
  const id = newId("projectTask");

  await db.insert(schema.projectTask).values({
    id,
    organizationId,
    projectId,
    title: input.title,
    description: input.description ?? null,
    assigneeId: input.assigneeId ?? null,
    priority: input.prioridad ?? null,
    estado: "pendiente",
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
