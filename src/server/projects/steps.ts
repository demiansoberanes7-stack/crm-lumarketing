/**
 * Servicio de pasos del expediente de proyecto.
 *
 * El stepper de cada proyecto se deriva del registro de tipos
 * (`src/lib/project-types.ts`): paso general + pasos propios del tipo.
 * Aquí se siembran los pasos, se guardan borradores/completados y se
 * mantienen sincronizados `avance`, `status`, `estado` (legado) y la
 * etapa del catálogo legacy para no romper dashboard ni reportes.
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { publishWebhook } from "@/server/webhooks/dispatcher";
import {
  PROJECT_STATUSES,
  findStep,
  isProjectTypeKey,
  parseStepData,
  statusToEstado,
  stepsForType,
  type ProjectStatus,
  type ProjectStepDef,
} from "@/lib/project-types";
import { ProjectError } from "./errors";
import { getProject, getProjectStages } from "./service";
import { validateProjectMember } from "./members";

export type StepStatus = "pendiente" | "en_proceso" | "completado";

export interface ProjectStepView {
  key: string;
  label: string;
  description: string | null;
  kind: ProjectStepDef["kind"];
  position: number;
  status: StepStatus;
  data: Record<string, unknown>;
  completedAt: string | null;
}

export interface StepSaveResult {
  step: ProjectStepView;
  avance: number;
  status: ProjectStatus;
  completedSteps: number;
  totalSteps: number;
}

/** Siembra los pasos que falten para el tipo del proyecto (idempotente). */
export async function ensureProjectSteps(
  organizationId: string,
  projectId: string,
  typeKey: string
): Promise<void> {
  if (!isProjectTypeKey(typeKey)) return;
  const db = getDb();
  const defs = stepsForType(typeKey);
  const existing = await db
    .select({ key: schema.projectStep.stepKey })
    .from(schema.projectStep)
    .where(
      and(
        scoped(schema.projectStep.organizationId, organizationId),
        eq(schema.projectStep.projectId, projectId)
      )
    );
  const have = new Set(existing.map((r) => r.key));
  const missing = defs
    .map((def, position) => ({ def, position }))
    .filter(({ def }) => !have.has(def.key));
  if (!missing.length) return;

  await db
    .insert(schema.projectStep)
    .values(
      missing.map(({ def, position }) => ({
        id: newId("projectStep"),
        organizationId,
        projectId,
        stepKey: def.key,
        position,
        status: "pendiente",
        data: {},
      }))
    )
    .onConflictDoNothing();
}

/** Lista los pasos del proyecto en el orden del stepper (siembra si faltan). */
export async function listProjectSteps(
  organizationId: string,
  projectId: string
): Promise<{ steps: ProjectStepView[]; avance: number; status: ProjectStatus }> {
  const project = await getProject(organizationId, projectId);
  if (!project) throw new ProjectError(404, "Proyecto no encontrado");

  await ensureProjectSteps(organizationId, projectId, project.projectType);
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.projectStep)
    .where(
      and(
        scoped(schema.projectStep.organizationId, organizationId),
        eq(schema.projectStep.projectId, projectId)
      )
    )
    .orderBy(asc(schema.projectStep.position));

  const defs = stepsForType(project.projectType);
  const byKey = new Map(rows.map((r) => [r.stepKey, r]));
  const isoDate = (d: Date | null): string | null =>
    d ? d.toISOString().slice(0, 10) : null;
  const steps: ProjectStepView[] = defs.map((def, position) => {
    const row = byKey.get(def.key);
    const status = (row?.status as StepStatus | undefined) ?? "pendiente";
    // El paso general vive en las columnas del proyecto, no en `data`.
    const data: Record<string, unknown> =
      def.kind === "project"
        ? {
            name: project.name,
            contactId: project.contactId,
            assignedUserId: project.assignedUserId,
            startDate: isoDate(project.startDate),
            endDate: isoDate(project.endDate),
            notas: project.notas,
          }
        : ((row?.data as Record<string, unknown> | undefined) ?? {});
    return {
      key: def.key,
      label: def.label,
      description: def.description ?? null,
      kind: def.kind,
      position,
      status,
      data,
      completedAt: row?.completedAt?.toISOString() ?? null,
    };
  });

  const status = (project.status as ProjectStatus) ?? "borrador";
  return { steps, avance: project.avance, status };
}

/** Aplica el paso general sobre las columnas del proyecto. */
async function applyGeneralData(
  organizationId: string,
  projectId: string,
  data: Record<string, unknown>
): Promise<void> {
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) throw new ProjectError(422, "El nombre del proyecto es obligatorio");

  const contactId = typeof data.contactId === "string" ? data.contactId : null;
  const assignedUserId =
    typeof data.assignedUserId === "string" ? data.assignedUserId : null;

  const db = getDb();
  if (contactId) {
    const [contact] = await db
      .select({ id: schema.contact.id })
      .from(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          organizationId,
          eq(schema.contact.id, contactId)
        )
      )
      .limit(1);
    if (!contact) throw new ProjectError(422, "El contacto no pertenece a tu organización");
  }
  await validateProjectMember(organizationId, assignedUserId);

  const toDate = (value: unknown): Date | null =>
    typeof value === "string" && value ? new Date(`${value}T00:00:00.000Z`) : null;

  await db
    .update(schema.project)
    .set({
      name,
      contactId,
      assignedUserId,
      startDate: toDate(data.startDate),
      endDate: toDate(data.endDate),
      notas: typeof data.notas === "string" && data.notas.trim() ? data.notas : null,
      updatedAt: new Date(),
    })
    .where(
      scoped(schema.project.organizationId, organizationId, eq(schema.project.id, projectId))
    );
}

/**
 * Guarda un paso: valida contra el registro, persiste (borrador o completado)
 * y recalcula avance + status + etapa legacy.
 */
export async function saveProjectStep(
  organizationId: string,
  projectId: string,
  stepKey: string,
  rawData: unknown,
  complete: boolean,
  actorUserId?: string
): Promise<StepSaveResult> {
  const project = await getProject(organizationId, projectId);
  if (!project) throw new ProjectError(404, "Proyecto no encontrado");
  if (project.archivedAt) throw new ProjectError(409, "El proyecto está archivado");

  const def = findStep(project.projectType, stepKey);
  if (!def) throw new ProjectError(422, "Paso no válido para el tipo de proyecto");

  const parsed = parseStepData(def, rawData);
  if (!parsed.ok) throw new ProjectError(422, parsed.message);

  await ensureProjectSteps(organizationId, projectId, project.projectType);
  const defs = stepsForType(project.projectType);
  const position = Math.max(0, defs.findIndex((d) => d.key === stepKey));

  if (def.kind === "project") {
    await applyGeneralData(organizationId, projectId, parsed.data);
  }

  const db = getDb();
  const now = new Date();
  const rowStatus: StepStatus = complete ? "completado" : "en_proceso";
  await db
    .insert(schema.projectStep)
    .values({
      id: newId("projectStep"),
      organizationId,
      projectId,
      stepKey,
      position,
      status: rowStatus,
      data: parsed.data,
      completedAt: complete ? now : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.projectStep.projectId, schema.projectStep.stepKey],
      set: {
        position,
        status: rowStatus,
        data: parsed.data,
        completedAt: complete ? now : null,
        updatedAt: now,
      },
    });

  const rows = await db
    .select({ key: schema.projectStep.stepKey, status: schema.projectStep.status })
    .from(schema.projectStep)
    .where(
      and(
        scoped(schema.projectStep.organizationId, organizationId),
        eq(schema.projectStep.projectId, projectId)
      )
    );
  const done = new Set(rows.filter((r) => r.status === "completado").map((r) => r.key));
  const completedSteps = defs.filter((d) => done.has(d.key)).length;
  const avance = defs.length ? Math.round((completedSteps / defs.length) * 100) : 0;

  // Trabajo nuevo: borrador o reabrir un completado vuelven a "en proceso".
  const status: ProjectStatus =
    project.status === "borrador" || project.status === "completado"
      ? "en_proceso"
      : (project.status as ProjectStatus);

  const { stageId, stageChanged, toStageName } = await syncLegacyStage(
    organizationId,
    projectId,
    project.stageId,
    completedSteps,
    defs.length
  );

  await db
    .update(schema.project)
    .set({
      avance,
      status,
      estado: statusToEstado(status),
      stageId,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(
      scoped(schema.project.organizationId, organizationId, eq(schema.project.id, projectId))
    );

  if (stageChanged && toStageName) {
    publishWebhook(organizationId, "project.stage_changed", {
      projectId,
      fromStageId: project.stageId,
      toStageId: stageId,
      toStageName,
      complete: avance === 100,
      source: "step",
      actorUserId: actorUserId ?? null,
    });
  }

  const view: ProjectStepView = {
    key: def.key,
    label: def.label,
    description: def.description ?? null,
    kind: def.kind,
    position,
    status: rowStatus,
    data: parsed.data,
    completedAt: complete ? now.toISOString() : null,
  };

  return { step: view, avance, status, completedSteps, totalSteps: defs.length };
}

/**
 * Mantiene la etapa del catálogo legacy (`project_stage`) en paralelo al
 * avance del stepper, para que dashboard e historial sigan teniendo datos.
 */
async function syncLegacyStage(
  organizationId: string,
  projectId: string,
  currentStageId: string | null,
  completedSteps: number,
  totalSteps: number
): Promise<{ stageId: string | null; stageChanged: boolean; toStageName: string | null }> {
  const stages = await getProjectStages(organizationId);
  if (!stages.length || !totalSteps) {
    return { stageId: currentStageId, stageChanged: false, toStageName: null };
  }
  const ratio = completedSteps / totalSteps;
  const index = Math.min(stages.length - 1, Math.floor(ratio * stages.length));
  const target = stages[index];
  if (!target || target.id === currentStageId) {
    return { stageId: currentStageId, stageChanged: false, toStageName: null };
  }

  const fromName = stages.find((s) => s.id === currentStageId)?.name ?? null;
  const db = getDb();
  await db.insert(schema.projectStageEvent).values({
    id: newId("projectStageEvent"),
    organizationId,
    projectId,
    fromStageId: currentStageId,
    fromStageName: fromName,
    toStageId: target.id,
    toStageName: target.name,
    actorUserId: null,
    source: "dueno",
  });

  return { stageId: target.id, stageChanged: true, toStageName: target.name };
}

/** Cambia el estado de workflow del proyecto (finalizar, reabrir, cancelar…). */
export async function setProjectStatus(
  organizationId: string,
  projectId: string,
  status: ProjectStatus,
  _actorUserId?: string
): Promise<{ changed: boolean; status: ProjectStatus; avance: number }> {
  if (!PROJECT_STATUSES.includes(status)) {
    throw new ProjectError(422, "Estado no válido");
  }
  const project = await getProject(organizationId, projectId);
  if (!project) throw new ProjectError(404, "Proyecto no encontrado");
  if (project.archivedAt) throw new ProjectError(409, "El proyecto está archivado");
  if (project.status === status) {
    return { changed: false, status, avance: project.avance };
  }

  await ensureProjectSteps(organizationId, projectId, project.projectType);
  const defs = stepsForType(project.projectType);
  const db = getDb();
  const rows = await db
    .select({ key: schema.projectStep.stepKey, status: schema.projectStep.status })
    .from(schema.projectStep)
    .where(
      and(
        scoped(schema.projectStep.organizationId, organizationId),
        eq(schema.projectStep.projectId, projectId)
      )
    );
  const done = new Set(rows.filter((r) => r.status === "completado").map((r) => r.key));
  const completedSteps = defs.filter((d) => done.has(d.key)).length;
  const computed = defs.length ? Math.round((completedSteps / defs.length) * 100) : 0;

  if (status === "completado" && completedSteps < defs.length) {
    const pending = defs.length - completedSteps;
    throw new ProjectError(
      422,
      `Faltan ${pending} paso${pending === 1 ? "" : "s"} por completar antes de finalizar`
    );
  }

  const avance =
    status === "completado" ? 100 : status === "cancelado" ? project.avance : computed;
  const now = new Date();
  await db
    .update(schema.project)
    .set({
      status,
      estado: statusToEstado(status),
      avance,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(
      scoped(schema.project.organizationId, organizationId, eq(schema.project.id, projectId))
    );

  return { changed: true, status, avance };
}
