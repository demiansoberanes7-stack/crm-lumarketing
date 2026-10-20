/**
 * Procesos de proyecto por negocio.
 *
 * La fuente de verdad en ejecución es `project_template`. El negocio principal
 * (el más antiguo de la instancia) recibe los tres procesos base como
 * `is_system` —solo lectura—; los demás negocios reciben copias editables.
 * Editar o borrar un proceso solo afecta a proyectos futuros: cada proyecto
 * congela su etiqueta y la definición de sus pasos al nacer.
 */
import { asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  DEFAULT_PROJECT_TEMPLATE_SEEDS,
  PROJECT_TEMPLATE_LIMITS,
  uniqueProjectKey,
  type ProjectTemplateDetail,
  type ProjectTemplateInput,
  type ProjectTemplateStep,
  type ProjectTemplateSummary,
} from "@/lib/project-templates";
import { GENERAL_STEP, type ProjectStepDef } from "@/lib/project-types";
import { ProjectError } from "./errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
type ProjectTemplateRow = typeof schema.projectTemplate.$inferSelect;

const ACTIVE = isNull(schema.projectTemplate.deletedAt);

function toDetail(row: ProjectTemplateRow): ProjectTemplateDetail {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    icon: row.icon,
    position: row.position,
    isSystem: row.isSystem,
    isDefault: row.isDefault,
    steps: Array.isArray(row.steps) ? row.steps : [],
    tasks: Array.isArray(row.tasks) ? row.tasks : [],
  };
}

async function readActive(db: Db, organizationId: string): Promise<ProjectTemplateRow[]> {
  return db
    .select()
    .from(schema.projectTemplate)
    .where(
      scoped(
        schema.projectTemplate.organizationId,
        organizationId,
        isNull(schema.projectTemplate.deletedAt)
      )
    )
    .orderBy(asc(schema.projectTemplate.position), asc(schema.projectTemplate.id));
}

async function isPrincipalOrganization(db: Db, organizationId: string): Promise<boolean> {
  const [oldest] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .orderBy(asc(schema.organization.createdAt), asc(schema.organization.id))
    .limit(1);
  return oldest?.id === organizationId;
}

/**
 * Devuelve los procesos activos del negocio y siembra los tres base la primera
 * vez. Si ya existió alguno (aunque se haya borrado), no vuelve a sembrar: las
 * decisiones del usuario se respetan.
 */
export async function ensureProjectTemplates(
  organizationId: string,
  db: Db = getDb()
): Promise<ProjectTemplateRow[]> {
  const [anyRow] = await db
    .select({ id: schema.projectTemplate.id })
    .from(schema.projectTemplate)
    .where(scoped(schema.projectTemplate.organizationId, organizationId))
    .limit(1);
  if (!anyRow) {
    const isPrincipal = await isPrincipalOrganization(db, organizationId);
    await db
      .insert(schema.projectTemplate)
      .values(
        DEFAULT_PROJECT_TEMPLATE_SEEDS.map((seed, position) => ({
          id: newId("projectTemplate"),
          organizationId,
          key: seed.key,
          label: seed.label,
          description: seed.description,
          icon: seed.icon,
          position,
          isSystem: isPrincipal,
          isDefault: position === 0,
          steps: seed.steps,
          tasks: seed.tasks,
        }))
      )
      .onConflictDoNothing();
  }
  return readActive(db, organizationId);
}

/** Procesos activos con conteos para las tarjetas del selector. */
export async function listProjectTemplates(
  organizationId: string
): Promise<ProjectTemplateSummary[]> {
  const db = getDb();
  const rows = await ensureProjectTemplates(organizationId, db);
  const counts = await db
    .select({
      key: schema.project.projectType,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.project)
    .where(scoped(schema.project.organizationId, organizationId))
    .groupBy(schema.project.projectType);
  const byKey = new Map(counts.map((row: { key: string; n: number }) => [row.key, row.n]));
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    icon: row.icon,
    position: row.position,
    isSystem: row.isSystem,
    isDefault: row.isDefault,
    stepsCount: Array.isArray(row.steps) ? row.steps.length : 0,
    tasksCount: Array.isArray(row.tasks) ? row.tasks.length : 0,
    projectCount: byKey.get(row.key) ?? 0,
  }));
}

/** Proceso por id (para editar y borrar). */
export async function getProjectTemplate(
  organizationId: string,
  id: string
): Promise<ProjectTemplateDetail | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.projectTemplate)
    .where(
      scoped(
        schema.projectTemplate.organizationId,
        organizationId,
        eq(schema.projectTemplate.id, id),
        ACTIVE
      )
    )
    .limit(1);
  return row ? toDetail(row) : null;
}

/** Proceso activo por clave; `null` si no existe o fue borrado. */
export async function getProjectTemplateByKey(
  organizationId: string,
  key: string,
  db: Db = getDb()
): Promise<ProjectTemplateDetail | null> {
  const [row] = await db
    .select()
    .from(schema.projectTemplate)
    .where(
      scoped(
        schema.projectTemplate.organizationId,
        organizationId,
        eq(schema.projectTemplate.key, key),
        ACTIVE
      )
    )
    .limit(1);
  return row ? toDetail(row) : null;
}

/** El proceso predeterminado (o el primero activo). */
export function pickDefaultTemplate(
  templates: ProjectTemplateDetail[]
): ProjectTemplateDetail | null {
  return templates.find((template) => template.isDefault) ?? templates[0] ?? null;
}

/**
 * Resuelve el proceso de un proyecto nuevo por clave; sin clave usa el
 * predeterminado. Falla con 422 si la clave no existe o fue borrada.
 */
export async function resolveProjectTemplate(
  organizationId: string,
  key?: string | null
): Promise<ProjectTemplateDetail> {
  const rows = await ensureProjectTemplates(organizationId);
  const templates = rows.map(toDetail);
  const template = key
    ? templates.find((row) => row.key === key)
    : pickDefaultTemplate(templates);
  if (!template) {
    throw new ProjectError(
      422,
      key
        ? "El proceso de proyecto no existe o fue eliminado"
        : "No hay procesos de proyecto configurados"
    );
  }
  return template;
}

/** Pasos completos de un proyecto nuevo a partir de un proceso. */
export function templateStepDefs(template: {
  steps: ProjectTemplateStep[];
}): ProjectStepDef[] {
  return [
    GENERAL_STEP,
    ...template.steps
      .filter((step) => step.key !== GENERAL_STEP.key)
      .map((step) => ({
        key: step.key,
        label: step.label,
        description: step.description ?? undefined,
        kind: "data" as const,
        fields: step.fields,
      })),
  ];
}

export async function createProjectTemplate(
  organizationId: string,
  input: ProjectTemplateInput
): Promise<ProjectTemplateDetail> {
  const db = getDb();
  const active = await ensureProjectTemplates(organizationId, db);
  if (active.length >= PROJECT_TEMPLATE_LIMITS.maxTemplatesPerOrg) {
    throw new ProjectError(
      409,
      `Puedes tener hasta ${PROJECT_TEMPLATE_LIMITS.maxTemplatesPerOrg} procesos por negocio`
    );
  }
  // La clave debe ser única incluso frente a procesos borrados: el índice
  // único de la tabla incluye las filas con `deleted_at`.
  const allKeys = await db
    .select({ key: schema.projectTemplate.key })
    .from(schema.projectTemplate)
    .where(scoped(schema.projectTemplate.organizationId, organizationId));
  const key = uniqueProjectKey(input.label, new Set(allKeys.map((row: { key: string }) => row.key)));
  const position = active.reduce((max, row) => Math.max(max, row.position), -1) + 1;

  const [row] = await db
    .insert(schema.projectTemplate)
    .values({
      id: newId("projectTemplate"),
      organizationId,
      key,
      label: input.label,
      description: input.description ?? null,
      icon: input.icon ?? "layers",
      position,
      isSystem: false,
      isDefault: active.length === 0,
      steps: input.steps.map((step) => ({
        key: step.key,
        label: step.label,
        description: step.description ?? null,
        fields: step.fields,
      })),
      tasks: (input.tasks ?? []).map((task) => ({
        title: task.title,
        description: task.description ?? null,
      })),
    })
    .returning();
  if (!row) throw new ProjectError(500, "No se pudo crear el proceso");
  return toDetail(row);
}

export async function updateProjectTemplate(
  organizationId: string,
  id: string,
  input: ProjectTemplateInput
): Promise<ProjectTemplateDetail> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.projectTemplate)
    .where(
      scoped(
        schema.projectTemplate.organizationId,
        organizationId,
        eq(schema.projectTemplate.id, id),
        ACTIVE
      )
    )
    .limit(1);
  if (!existing) throw new ProjectError(404, "Proceso no encontrado");
  if (existing.isSystem) {
    throw new ProjectError(403, "Este proceso es del sistema y no se puede editar");
  }

  const [row] = await db
    .update(schema.projectTemplate)
    .set({
      label: input.label,
      description: input.description ?? null,
      icon: input.icon ?? existing.icon,
      steps: input.steps.map((step) => ({
        key: step.key,
        label: step.label,
        description: step.description ?? null,
        fields: step.fields,
      })),
      tasks: (input.tasks ?? []).map((task) => ({
        title: task.title,
        description: task.description ?? null,
      })),
      updatedAt: new Date(),
    })
    .where(
      scoped(schema.projectTemplate.organizationId, organizationId, eq(schema.projectTemplate.id, id))
    )
    .returning();
  if (!row) throw new ProjectError(404, "Proceso no encontrado");
  return toDetail(row);
}

/** Borrado lógico; si era el predeterminado, promueve al siguiente activo. */
export async function deleteProjectTemplate(
  organizationId: string,
  id: string
): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.projectTemplate)
    .where(
      scoped(
        schema.projectTemplate.organizationId,
        organizationId,
        eq(schema.projectTemplate.id, id),
        ACTIVE
      )
    )
    .limit(1);
  if (!existing) throw new ProjectError(404, "Proceso no encontrado");
  if (existing.isSystem) {
    throw new ProjectError(403, "Este proceso es del sistema y no se puede borrar");
  }

  const active = await readActive(db, organizationId);
  if (active.length <= 1) {
    throw new ProjectError(409, "Debe quedar al menos un proceso de proyecto");
  }

  await db.transaction(async (tx: Db) => {
    if (existing.isDefault) {
      const next = active.find((row) => row.id !== id);
      await tx
        .update(schema.projectTemplate)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          scoped(
            schema.projectTemplate.organizationId,
            organizationId,
            eq(schema.projectTemplate.id, id)
          )
        );
      if (next) {
        await tx
          .update(schema.projectTemplate)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(
            scoped(
              schema.projectTemplate.organizationId,
              organizationId,
              eq(schema.projectTemplate.id, next.id)
            )
          );
      }
    }
    await tx
      .update(schema.projectTemplate)
      .set({ deletedAt: new Date(), isDefault: false, updatedAt: new Date() })
      .where(
        scoped(
          schema.projectTemplate.organizationId,
          organizationId,
          eq(schema.projectTemplate.id, id)
        )
      );
  });
}
