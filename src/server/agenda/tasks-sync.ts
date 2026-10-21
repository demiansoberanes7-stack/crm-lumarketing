import { and, eq, getTableColumns, isNotNull, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { hasIdKind } from "@/lib/db/ids";
import { agendaEnabled } from "@/server/agenda/flag";
import { recordDiagnostic } from "@/server/diagnostics/logger";
import { googleFetch } from "@/server/agenda/connectors/google";
import {
  getGoogleCredentials,
  markGoogleError,
  type GoogleCreds,
} from "@/server/agenda/connectors/google-credentials";

/**
 * 015 — Sincronización de Pendientes y tareas de proyecto hacia Google
 * Calendar.
 *
 * Es la otra mitad de la conexión de Google: lo que ya existe hoy son las
 * CITAS (motor de agenda, con Meet). Esto lleva al calendario del dueño lo
 * que hace en el día a día: las tareas de Pendientes y las tareas de los
 * proyectos, con su fecha.
 *
 * Tres reglas que lo hacen apto para producción:
 *
 *  1. **OPT-IN.** Apagado por defecto (`google_credentials.sync_tasks`): una
 *     instancia nueva no escribe en el calendario de nadie hasta que el dueño
 *     lo enciende en Ajustes → Google.
 *  2. **Nunca bloquea.** Corre DESPUÉS de que la tarea ya está guardada, dentro
 *     de un try/catch que solo deja un diagnóstico. Si Google cae, la tarea
 *     queda perfecta y el evento se reintentará en la siguiente edición.
 *  3. **Un evento por tarea.** El id de Google se guarda en la propia fila
 *     (`google_event_id`): editar mueve el mismo evento y no duplica; borrar la
 *     tarea borra el evento. Si la fecha desaparece, se retira el evento.
 */

export type SyncableTask = {
  id: string;
  kind: "caltodo" | "project";
  title: string;
  description?: string | null;
  /** Momento en que empieza el evento; `null` = sin fecha, no hay evento. */
  start: Date | null;
  end?: Date | null;
  googleEventId?: string | null;
  /** Nombre del proyecto, para anteponerlo al asunto. */
  prefix?: string | null;
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Nada de esto corre si la bandera está apagada o si el negocio no conectó
 * Google con la sincronización encendida: la consulta ni siquiera se hace.
 */
async function syncContext(
  organizationId: string
): Promise<GoogleCreds | null> {
  if (!agendaEnabled()) return null;
  const creds = await getGoogleCredentials(organizationId);
  if (!creds || creds.status !== "connected" || !creds.syncTasks) return null;
  return creds;
}

function eventsPath(creds: GoogleCreds): string {
  return `/calendars/${encodeURIComponent(creds.calendarId)}/events`;
}

/** Fecha calendario (UTC) de un `dueDate` que la UI manda como mediodía UTC. */
function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Recordatorios explícitos: con `useDefault` el aviso depende de la
 * configuración del calendario del dueño, y un calendario sin avisos por
 * defecto no notificaría nada. Se fija un popup y Google lo respeta.
 *
 * En los eventos de todo el día (fechas límite de proyecto) el "inicio" es la
 * medianoche, por eso 9:00 son 540 minutos.
 */
function reminders(task: SyncableTask): Record<string, unknown> {
  return {
    useDefault: false,
    overrides: [
      { method: "popup", minutes: task.kind === "project" ? 9 * 60 : 30 },
    ],
  };
}

function eventBody(task: SyncableTask): Record<string, unknown> {
  const start = task.start as Date;
  const summary = task.prefix ? `[${task.prefix}] ${task.title}` : task.title;
  const description = task.description?.trim() || undefined;

  if (task.kind === "project") {
    // Fecha límite: todo el día. `end` es exclusivo en Google, por eso +1.
    return {
      summary,
      description,
      start: { date: ymd(start) },
      end: { date: ymd(new Date(start.getTime() + DAY_MS)) },
      reminders: reminders(task),
    };
  }
  const end =
    task.end && task.end.getTime() > start.getTime()
      ? task.end
      : new Date(start.getTime() + HOUR_MS);
  return {
    summary,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    reminders: reminders(task),
  };
}

async function saveEventId(
  organizationId: string,
  task: SyncableTask,
  eventId: string | null
): Promise<void> {
  const db = getDb();
  if (task.kind === "project") {
    await db
      .update(schema.projectTask)
      .set({ googleEventId: eventId })
      .where(
        and(
          eq(schema.projectTask.id, task.id),
          scoped(schema.projectTask.organizationId, organizationId)
        )
      );
    return;
  }
  await db
    .update(schema.caltodoTask)
    .set({ googleEventId: eventId })
    .where(
      and(
        eq(schema.caltodoTask.id, task.id),
        scoped(schema.caltodoTask.organizationId, organizationId)
      )
    );
}

async function readTask(
  organizationId: string,
  taskId: string
): Promise<SyncableTask | null> {
  const db = getDb();
  if (hasIdKind(taskId, "projectTask")) {
    const rows = await db
      .select({
        ...getTableColumns(schema.projectTask),
        projectName: schema.project.name,
      })
      .from(schema.projectTask)
      .leftJoin(schema.project, eq(schema.project.id, schema.projectTask.projectId))
      .where(
        and(
          eq(schema.projectTask.id, taskId),
          scoped(schema.projectTask.organizationId, organizationId)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      kind: "project",
      title: row.title,
      description: row.description,
      start: row.dueDate,
      googleEventId: row.googleEventId,
      prefix: row.projectName,
    };
  }

  const rows = await db
    .select()
    .from(schema.caltodoTask)
    .where(
      and(
        eq(schema.caltodoTask.id, taskId),
        scoped(schema.caltodoTask.organizationId, organizationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const start = row.scheduledStart;
  const end =
    row.scheduledEnd ??
    (start ? new Date(start.getTime() + (row.duration ?? 60) * 60_000) : null);
  return {
    id: row.id,
    kind: "caltodo",
    title: row.title,
    description: row.details,
    start,
    end,
    googleEventId: row.googleEventId,
  };
}

/**
 * Credencial rechazada (refresh token revocado o revocado por Google).
 * Se comprueba la marca del error y no `instanceof` para no depender de que
 * ambas rutas compartan la misma instancia del módulo.
 */
function isRevokedCredentials(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { isAuthError?: unknown }).isAuthError === true
  );
}

/** El fallo de Google se anota y se sigue: la tarea ya está guardada. */
async function noteFailure(
  organizationId: string,
  taskId: string,
  error: unknown
): Promise<void> {
  try {
    await recordDiagnostic({
      organizationId,
      source: "agenda",
      code: "tasks_sync_failed",
      severity: "warning",
      error,
      metadata: { taskId },
    });
  } catch {
    /* ni siquiera el diagnóstico puede tumbar la operación */
  }
  // Un refresh token revocado deja de funcionar en silencio: la tarea se
  // guarda, pero sin evento. Marcarlo hace que Ajustes pida reconectar en vez
  // de seguir diciendo "conectado".
  if (isRevokedCredentials(error)) {
    await markGoogleError(organizationId).catch(() => {});
  }
}

async function pushWithCreds(
  creds: GoogleCreds,
  organizationId: string,
  task: SyncableTask
): Promise<void> {
  const events = eventsPath(creds);

  if (!task.start) {
    // Perdió su fecha: retira el evento y olvida su id.
    if (task.googleEventId) {
      await googleFetch(creds, `${events}/${task.googleEventId}`, {
        method: "DELETE",
        allow404: true,
      });
      await saveEventId(organizationId, task, null);
    }
    return;
  }

  const body = JSON.stringify(eventBody(task));
  if (task.googleEventId) {
    const updated = await googleFetch(
      creds,
      `${events}/${task.googleEventId}`,
      { method: "PATCH", body, allow404: true }
    );
    if (updated) return;
    // Google no lo tiene (404): se recrea abajo y el id se reemplaza.
  }

  const created = (await googleFetch(creds, events, {
    method: "POST",
    body,
  })) as { id?: string } | null;
  if (created?.id) await saveEventId(organizationId, task, created.id);
}

/** Crea o mueve el evento de una tarea ya identificada. Nunca lanza. */
export async function syncTaskById(
  organizationId: string,
  taskId: string
): Promise<void> {
  const creds = await syncContext(organizationId);
  if (!creds) return;
  try {
    const task = await readTask(organizationId, taskId);
    if (!task) return;
    await pushWithCreds(creds, organizationId, task);
  } catch (error) {
    await noteFailure(organizationId, taskId, error);
  }
}

/** Igual, pero con la tarea en mano (para pruebas y llamadas con fila fresca). */
export async function pushTaskEvent(
  organizationId: string,
  task: SyncableTask
): Promise<void> {
  const creds = await syncContext(organizationId);
  if (!creds) return;
  try {
    await pushWithCreds(creds, organizationId, task);
  } catch (error) {
    await noteFailure(organizationId, task.id, error);
  }
}

/**
 * El id de Google que tenga la tarea, o `null`. `null` también cuando la
 * sincronización está apagada: entonces no hay evento que retirar.
 */
export async function taskEventIdFor(
  organizationId: string,
  taskId: string
): Promise<string | null> {
  const creds = await syncContext(organizationId);
  if (!creds) return null;
  try {
    const task = await readTask(organizationId, taskId);
    return task?.googleEventId ?? null;
  } catch (error) {
    await noteFailure(organizationId, taskId, error);
    return null;
  }
}

/** Borra el evento de Google. Se llama DESPUÉS de que la fila ya no existe. */
export async function removeTaskEvent(
  organizationId: string,
  googleEventId: string | null | undefined
): Promise<void> {
  if (!googleEventId) return;
  const creds = await syncContext(organizationId);
  if (!creds) return;
  try {
    await googleFetch(creds, `${eventsPath(creds)}/${googleEventId}`, {
      method: "DELETE",
      allow404: true,
    });
  } catch (error) {
    await noteFailure(organizationId, googleEventId, error);
  }
}

/**
 * Pone al día las tareas que ya existían cuando se encendió la sincronización
 * o cuando se reconectó Google. Sin esto, activar el interruptor solo servía
 * para lo que se creara después, y quien reconectaba tras un token revocado
 * seguía viendo tareas viejas sin evento.
 *
 * Solo lee filas SIN `google_event_id`: nunca duplica un evento existente.
 * Si Google rechaza las credenciales, corta en el primer fallo en vez de
 * martillar la API con el mismo token muerto.
 */
export async function syncPendingTasks(
  organizationId: string,
  limit = 100
): Promise<{ synced: number; failed: number }> {
  const creds = await syncContext(organizationId);
  if (!creds) return { synced: 0, failed: 0 };

  const db = getDb();
  const pending: SyncableTask[] = [];

  try {
    const caltodoRows = await db
      .select()
      .from(schema.caltodoTask)
      .where(
        and(
          scoped(schema.caltodoTask.organizationId, organizationId),
          eq(schema.caltodoTask.completed, false),
          isNotNull(schema.caltodoTask.scheduledStart),
          isNull(schema.caltodoTask.googleEventId)
        )
      )
      .limit(limit);

    for (const row of caltodoRows) {
      if (!row.scheduledStart) continue;
      pending.push({
        id: row.id,
        kind: "caltodo",
        title: row.title,
        description: row.details,
        start: row.scheduledStart,
        end:
          row.scheduledEnd ??
          new Date(row.scheduledStart.getTime() + (row.duration ?? 60) * 60_000),
        googleEventId: row.googleEventId,
      });
    }

    const projectRows = await db
      .select({
        ...getTableColumns(schema.projectTask),
        projectName: schema.project.name,
      })
      .from(schema.projectTask)
      .leftJoin(schema.project, eq(schema.project.id, schema.projectTask.projectId))
      .where(
        and(
          scoped(schema.projectTask.organizationId, organizationId),
          ne(schema.projectTask.estado, "terminado"),
          isNotNull(schema.projectTask.dueDate),
          isNull(schema.projectTask.googleEventId)
        )
      )
      .limit(limit);

    for (const row of projectRows) {
      if (!row.dueDate) continue;
      pending.push({
        id: row.id,
        kind: "project",
        title: row.title,
        description: row.description,
        start: row.dueDate,
        googleEventId: row.googleEventId,
        prefix: row.projectName,
      });
    }
  } catch (error) {
    await noteFailure(organizationId, "backfill", error);
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;
  for (const task of pending.slice(0, limit)) {
    try {
      await pushWithCreds(creds, organizationId, task);
      synced += 1;
    } catch (error) {
      failed += 1;
      await noteFailure(organizationId, task.id, error);
      if (isRevokedCredentials(error)) break;
    }
  }
  return { synced, failed };
}
