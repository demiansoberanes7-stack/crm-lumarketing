import { and, asc, eq, gte, isNotNull, isNull, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  DEFAULT_CONNECTOR,
  isConnectorId,
  type ConnectorId,
} from "@/lib/agenda-connectors";
import { agendaEnabled } from "@/server/agenda/flag";
import { recordDiagnostic } from "@/server/diagnostics/logger";
import { googleFetch } from "@/server/agenda/connectors/google";
import {
  getBusinessGoogleCredentials,
  markGoogleError,
  type GoogleCreds,
} from "@/server/agenda/connectors/google-credentials";

/**
 * 015 · B1 — Citas del CRM hacia Google Calendar.
 *
 * Lo que `tasks-sync.ts` hace con las tareas, aquí lo hacen las citas: que el
 * día del negocio esté en el calendario que ya mira, con su hora, su motivo y
 * su enlace.
 *
 * Cinco reglas, y la segunda es la que evita el duplicado que este módulo podía
 * causarse a sí mismo:
 *
 *  1. **Nunca bloquea.** Corre DESPUÉS de escribir la verdad del CRM y dentro de
 *     un try/catch que solo deja un diagnóstico. Si Google cae, la cita queda
 *     perfecta y el evento se reintenta en la siguiente edición o en el poller.
 *  2. **Un evento por cita, dos caminos según el conector.** Con `connector ===
 *     "google"` el evento que creó `createMeeting` ES el evento de calendario:
 *     la sincronización ADOPTA su id en `google_event_id` y no llama a Google
 *     (quien mueve o borra ese evento ya es `updateMeeting`/`deleteMeeting`).
 *     Con Zoom, enlace fijo o sin conector, el CRM crea SU propio evento y le
 *     pone el enlace en la descripción. Un tercer camino —crear un evento aparte
 *     encima de uno de Meet— dejaría dos citas en el calendario del dueño.
 *  3. **El calendario es siempre el del negocio** (decisión D2): una cita la
 *     reserva un cliente contra la agenda de la empresa, no contra la de quien
 *     la atiende. La separación por persona vive en las tareas.
 *  4. **Cancelada ⇒ sin evento.** Se retira y se olvida el id. Con el conector
 *     Google ya lo retiró `deleteMeeting`; aquí se limpia la marca local.
 *     Si aquel borrado falló, el evento queda en Google y el dueño lo borra a
 *     mano — el CRM no puede seguir afirmando que es suyo.
 *  5. **Sandbox y bloques fuera.** Una cita del Laboratorio (`is_test`) jamás
 *     llega a Google, y los `kind = "block"` tampoco: un bloqueo no tiene
 *     cliente ni reunión, y volcarlo al calendario del dueño sería inventarnos
 *     un objeto que nadie pidió. Solo se sincronizan sesiones.
 */

type BookingRow = typeof schema.booking.$inferSelect;

const CANCELADA = "cancelada";

/** El conector con el que NACIÓ la cita; `null` (fila anterior a la columna) = el soberano. */
function connectorOf(booking: BookingRow): ConnectorId {
  const raw = booking.connector ?? "";
  return isConnectorId(raw) ? raw : DEFAULT_CONNECTOR;
}

function eventsPath(creds: GoogleCreds): string {
  return `/calendars/${encodeURIComponent(creds.calendarId)}/events`;
}

/** Nada de esto corre sin bandera ni sin calendario del negocio conectado. */
async function syncContext(organizationId: string): Promise<GoogleCreds | null> {
  if (!agendaEnabled()) return null;
  const creds = await getBusinessGoogleCredentials(organizationId);
  if (!creds || creds.status !== "connected") return null;
  return creds;
}

async function contactName(
  organizationId: string,
  contactId: string
): Promise<string> {
  const rows = await getDb()
    .select({ name: schema.contact.name })
    .from(schema.contact)
    .where(
      scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId))
    )
    .limit(1);
  return rows[0]?.name ?? "";
}

/**
 * El asunto de la cita, con la MISMA regla que muestra la pantalla: motivo
 * propio y, si no, el nombre del cliente. Se exporta porque el conector de
 * Google escribe ese mismo asunto al crear la reunión: dos reglas distintas
 * harían que el calendario y la cita del CRM digan cosas diferentes de lo mismo.
 */
export async function bookingSummary(
  organizationId: string,
  booking: { title: string | null; contactId: string | null },
  /** Nombre ya resuelto por el llamador, para no releer el contacto. */
  contactNameHint?: string
): Promise<string> {
  const own = booking.title?.trim();
  if (own) return own;
  const name =
    contactNameHint ??
    (booking.contactId ? await contactName(organizationId, booking.contactId) : "");
  return name ? `Cita — ${name}` : "Cita";
}

/**
 * La descripción lleva las notas y el enlace. Se manda `undefined` (no `""`)
 * cuando no hay nada: un PATCH con cadena vacía BORRA la descripción que Google
 * ya tuviera puesta.
 */
export function bookingDescription(booking: {
  notes: string | null;
  meetingLink: string | null;
}): string | undefined {
  const parts = [
    booking.notes?.trim() || null,
    booking.meetingLink ? `Enlace de la reunión: ${booking.meetingLink}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
}

async function eventBody(
  organizationId: string,
  booking: BookingRow
): Promise<Record<string, unknown>> {
  const start = booking.scheduledAt;
  const end = new Date(start.getTime() + booking.durationMinutes * 60_000);
  const location = booking.location?.trim();
  return {
    summary: await bookingSummary(organizationId, booking),
    description: bookingDescription(booking),
    ...(location ? { location } : {}),
    start: { dateTime: start.toISOString(), timeZone: "UTC" },
    end: { dateTime: end.toISOString(), timeZone: "UTC" },
    // Aviso explícito: con `useDefault` un calendario sin avisos por defecto no
    // notificaría nada. 30 minutos es el margen con el que se llega a una cita.
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
  };
}

/** El id del evento se guarda en la propia fila: es lo que responde «¿ya tiene evento?». */
async function saveEventId(
  organizationId: string,
  bookingId: string,
  eventId: string | null
): Promise<void> {
  await getDb()
    .update(schema.booking)
    .set({ googleEventId: eventId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.booking.id, bookingId),
        scoped(schema.booking.organizationId, organizationId)
      )
    );
}

/**
 * Camino 1 — el conector es Google: espejo local, cero llamadas.
 *
 * Sin `external_ref` no hay nada que adoptar: la entrega de la reunión falló y
 * es ESE camino el que tiene que crear el evento (y darle el Meet). Crearlo
 * aquí desde la sincronización dejaría dos eventos en cuanto el operador
 * pulsara «reintentar enlace».
 */
async function adopt(organizationId: string, booking: BookingRow): Promise<void> {
  if (booking.status === CANCELADA) {
    if (booking.googleEventId) await saveEventId(organizationId, booking.id, null);
    return;
  }
  if (!booking.externalRef) return;
  if (booking.googleEventId === booking.externalRef) return;
  await saveEventId(organizationId, booking.id, booking.externalRef);
}

/** Camino 2 — el CRM crea y mantiene SU evento de calendario. */
async function push(
  creds: GoogleCreds,
  organizationId: string,
  booking: BookingRow
): Promise<void> {
  const events = eventsPath(creds);

  if (booking.status === CANCELADA) {
    if (!booking.googleEventId) return;
    await googleFetch(creds, `${events}/${booking.googleEventId}`, {
      method: "DELETE",
      allow404: true,
    });
    await saveEventId(organizationId, booking.id, null);
    return;
  }

  const body = JSON.stringify(await eventBody(organizationId, booking));
  if (booking.googleEventId) {
    const updated = await googleFetch(
      creds,
      `${events}/${booking.googleEventId}`,
      { method: "PATCH", body, allow404: true }
    );
    if (updated) return;
    // Google no lo tiene (404, p. ej. tras reconectar con otro calendario): se
    // recrea abajo y el id se reemplaza.
  }
  const created = (await googleFetch(creds, events, {
    method: "POST",
    body,
  })) as { id?: string } | null;
  if (created?.id) await saveEventId(organizationId, booking.id, created.id);
}

async function run(
  creds: GoogleCreds,
  organizationId: string,
  booking: BookingRow
): Promise<void> {
  if (connectorOf(booking) === "google") {
    await adopt(organizationId, booking);
    return;
  }
  await push(creds, organizationId, booking);
}

/**
 * El fallo de Google se anota y se sigue: la cita ya está guardada.
 *
 * Se marca la fila del NEGOCIO, que es la única que estas citas usan. Un 401/400
 * significa refresh token revocado — la app en modo prueba caduca a los 7 días —
 * y deja de ser un silencio: Ajustes pasa a pedir reconectar.
 */
async function noteFailure(
  organizationId: string,
  bookingId: string,
  error: unknown
): Promise<void> {
  try {
    await recordDiagnostic({
      organizationId,
      source: "agenda",
      code: "bookings_sync_failed",
      severity: "warning",
      error,
      metadata: { bookingId },
    });
  } catch {
    /* ni siquiera el diagnóstico puede tumbar la operación */
  }
  const isAuthError =
    typeof error === "object" &&
    error !== null &&
    (error as { isAuthError?: unknown }).isAuthError === true;
  if (isAuthError) await markGoogleError(organizationId, null).catch(() => {});
}

/**
 * Pone al día el evento de una cita. Se llama SIEMPRE después de escribir la
 * cita y nunca lanza: el llamador no tiene forma de estropear la operación del
 * CRM por culpa de Google.
 */
export async function syncBookingEvent(
  organizationId: string,
  bookingId: string
): Promise<void> {
  if (!agendaEnabled()) return;
  try {
    // Se relee la fila: el llamador acaba de escribirla y puede tenerla vieja
    // (p. ej. `cancelBooking` trabaja con la fila previa al update).
    const rows = await getDb()
      .select()
      .from(schema.booking)
      .where(
        and(
          eq(schema.booking.id, bookingId),
          scoped(schema.booking.organizationId, organizationId)
        )
      )
      .limit(1);
    const booking = rows[0];
    if (!booking || booking.isTest || booking.kind !== "session") return;
    const creds = await syncContext(organizationId);
    if (!creds) return;
    await run(creds, organizationId, booking);
  } catch (error) {
    await noteFailure(organizationId, bookingId, error);
  }
}

/**
 * Relleno de citas que ya existían cuando se conectó Google (o cuando se revocó
 * el token). Solo filas SIN `google_event_id`: nunca duplica un evento.
 *
 * Dos lecturas deliberadas y en distinto orden:
 *
 *  - Las del conector Google se adoptan aunque sean pasadas: es un escribir
 *    local, no un evento nuevo.
 *  - Las que necesitan evento propio se limitan a citas FUTURAS. Reconectar el
 *    calendario no debe inundarlo con el histórico de meses atrás.
 *
 * Si Google rechaza las credenciales, corta en el primer fallo en vez de
 * martillar la API con el mismo token muerto.
 */
export async function syncPendingBookings(
  organizationId: string,
  limit = 100
): Promise<{ synced: number; failed: number }> {
  if (!agendaEnabled()) return { synced: 0, failed: 0 };
  const now = new Date();

  const base = [
    scoped(schema.booking.organizationId, organizationId),
    eq(schema.booking.kind, "session"),
    eq(schema.booking.isTest, false),
    isNull(schema.booking.googleEventId),
  ];

  let googleRows: BookingRow[] = [];
  let otherRows: BookingRow[] = [];
  try {
    const db = getDb();
    googleRows = await db
      .select()
      .from(schema.booking)
      .where(
        and(
          ...base,
          eq(schema.booking.connector, "google"),
          isNotNull(schema.booking.externalRef),
          ne(schema.booking.status, CANCELADA)
        )
      )
      .orderBy(asc(schema.booking.scheduledAt))
      .limit(limit);

    otherRows = await db
      .select()
      .from(schema.booking)
      .where(
        and(
          ...base,
          ne(schema.booking.status, CANCELADA),
          gte(schema.booking.scheduledAt, now),
          or(
            isNull(schema.booking.connector),
            ne(schema.booking.connector, "google")
          )
        )
      )
      .orderBy(asc(schema.booking.scheduledAt))
      .limit(limit);
  } catch (error) {
    await noteFailure(organizationId, "backfill", error);
    return { synced: 0, failed: 0 };
  }

  const pending = [...googleRows, ...otherRows];
  if (!pending.length) return { synced: 0, failed: 0 };

  const creds = await syncContext(organizationId);
  if (!creds) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  for (const booking of pending) {
    try {
      await run(creds, organizationId, booking);
      synced += 1;
    } catch (error) {
      failed += 1;
      await noteFailure(organizationId, booking.id, error);
      const isAuthError =
        typeof error === "object" &&
        error !== null &&
        (error as { isAuthError?: unknown }).isAuthError === true;
      if (isAuthError) break;
    }
  }
  return { synced, failed };
}
