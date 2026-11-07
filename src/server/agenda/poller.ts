import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { agendaEnabled } from "@/server/agenda/flag";
import { listGoogleCalendars } from "@/server/agenda/connectors/google-credentials";
import { syncPendingBookings } from "@/server/agenda/bookings-sync";
import { syncGoogleCalendarEvents } from "@/server/agenda/google-events-import";
import { syncPendingTasks } from "@/server/agenda/tasks-sync";

/**
 * Poller in-process de Google Calendar (B1d).
 *
 * Escribe la verdad del CRM en Google ANTES de llegar aquí (los efectos de
 * `service.ts` y `tasks-sync.ts` corren en la misma petición). Lo que este
 * barrido añade es la reparación: lo que se quedó sin evento porque Google
 * estuvo caído, porque el token estaba revocado, o porque la fila existía antes
 * de conectar el calendario. Sin él, ese hueco solo se cerraba la siguiente vez
 * que alguien editaba la tarea o la cita — que en una cita pasada nunca vuelve a
 * ocurrir.
 *
 * Cinco minutos y sin fila de trabajo: es el patrón de la casa (`email/poller`)
 * y con tres o cuatro negocios conectados, el coste real es cero — cada
 * organización solo se barre si tiene Google `connected`, y el trabajo se limita
 * a las filas que aún no tienen evento.
 *
 * LO QUE DELIBERADAMENTE NO REINTENTA: el enlace de Meet de una cita con
 * `link_pending`. Eso cambia lo que recibe el cliente (un enlace nuevo, no el
 * que se le prometió) y es una decisión del dueño, que ya tiene el botón
 * «Reintentar enlace» en la ficha de la cita. Automatizarlo sería repartir
 * enlaces sin que nadie lo haya pedido.
 */

const POLL_MS = 5 * 60_000;
/** Techo de llamadas por organización y barrido: Google tiene su propio cupo. */
const BATCH = 100;
/** Fila de `sync_state` donde se anota el último barrido. */
const PROVIDER = "google_calendar";

const workerState = globalThis as typeof globalThis & {
  __agendaPoll?: ReturnType<typeof setInterval>;
  __agendaTick?: boolean;
};

export type AgendaTickResult = {
  orgs: number;
  bookings: number;
  googleEvents: number;
  tasks: number;
  failed: number;
};

export function agendaWorkerReady(): boolean {
  return Boolean(workerState.__agendaPoll);
}

export async function startAgendaWorker(): Promise<void> {
  if (workerState.__agendaPoll) return;
  // Barrido inmediato diferido: el proceso todavía está compilando rutas.
  setTimeout(() => void runAgendaWorkerOnce(), 60_000).unref?.();
  workerState.__agendaPoll = setInterval(() => {
    void runAgendaWorkerOnce();
  }, POLL_MS);
  workerState.__agendaPoll.unref?.();
}

/**
 * Un barrido. Exportado para pruebas y para el reintento manual.
 *
 * Se autoapaga sin la bandera de agenda: registrarlo en `instrumentation` es
 * inofensivo en las instancias que no usan Citas.
 */
export async function runAgendaWorkerOnce(): Promise<AgendaTickResult> {
  const empty: AgendaTickResult = {
    orgs: 0,
    bookings: 0,
    googleEvents: 0,
    tasks: 0,
    failed: 0,
  };
  if (!agendaEnabled() || workerState.__agendaTick) return empty;
  workerState.__agendaTick = true;
  try {
    const calendars = await listGoogleCalendars();
    // Las citas van al calendario del negocio (`userId` null); las tareas al de
    // su dueño, así que basta con saber QUÉ organizaciones tienen algo conectado
    // — `syncPendingTasks` resuelve el calendario de cada fila por su cuenta.
    const bookingOrgs = new Set(
      calendars.filter((c) => c.userId === null).map((c) => c.organizationId)
    );
    const taskOrgs = new Set(
      calendars.filter((c) => c.syncTasks).map((c) => c.organizationId)
    );
    const orgs = new Set([...bookingOrgs, ...taskOrgs]);

    const result: AgendaTickResult = {
      orgs: orgs.size,
      bookings: 0,
      googleEvents: 0,
      tasks: 0,
      failed: 0,
    };
    for (const organizationId of orgs) {
      let bookings = { synced: 0, failed: 0 };
      let googleEvents = { imported: 0, updated: 0, cancelled: 0, conflicts: 0, failed: 0 };
      let tasks = { synced: 0, failed: 0 };
      try {
        if (bookingOrgs.has(organizationId)) {
          bookings = await syncPendingBookings(organizationId, BATCH);
          googleEvents = await syncGoogleCalendarEvents(organizationId);
        }
        if (taskOrgs.has(organizationId)) {
          tasks = await syncPendingTasks(organizationId, BATCH);
        }
      } catch (err) {
        // Un fallo aquí no puede matar el intervalo: el siguiente tick vuelve.
        await record(organizationId, "error", String(err), {
          bookings: bookings.synced,
          googleEvents: googleEvents.imported + googleEvents.updated + googleEvents.cancelled,
          tasks: tasks.synced,
        });
        continue;
      }
      result.bookings += bookings.synced;
      result.googleEvents +=
        googleEvents.imported + googleEvents.updated + googleEvents.cancelled;
      result.tasks += tasks.synced;
      result.failed += bookings.failed + googleEvents.failed + tasks.failed;
      await record(
        organizationId,
        bookings.failed + googleEvents.failed + tasks.failed > 0 ? "error" : "ok",
        bookings.failed + googleEvents.failed + tasks.failed > 0
          ? `${bookings.failed} cita(s) no llegaron a Google, ${googleEvents.failed} sincronización(es) Google→CRM fallaron y ${tasks.failed} tarea(s) no llegaron al calendario`
          : null,
        {
          bookings: bookings.synced,
          googleEvents: googleEvents.imported + googleEvents.updated + googleEvents.cancelled,
          googleConflicts: googleEvents.conflicts,
          tasks: tasks.synced,
        }
      );
    }
    return result;
  } finally {
    workerState.__agendaTick = false;
  }
}

/**
 * La marca del último barrido, en la tabla que ya existe para eso.
 *
 * Es lo que responde «¿por qué esta cita no está en mi calendario?» sin leer
 * logs: si el poller corrió, con qué resultado y con qué error. Su fallo es
 * silenciado a propósito — perder la marca no debe perder el trabajo hecho.
 */
async function record(
  organizationId: string,
  status: "ok" | "error",
  error: string | null,
  detail: Record<string, unknown>
): Promise<void> {
  const now = new Date();
  try {
    await getDb()
      .insert(schema.syncState)
      .values({
        id: newId("syncState"),
        organizationId,
        provider: PROVIDER,
        lastSyncAt: now,
        lastStatus: status,
        lastError: error,
        detail,
      })
      .onConflictDoUpdate({
        target: [schema.syncState.organizationId, schema.syncState.provider],
        set: { lastSyncAt: now, lastStatus: status, lastError: error, detail, updatedAt: now },
      });
  } catch {
    /* la marca es informativa, nunca indispensable */
  }
}
