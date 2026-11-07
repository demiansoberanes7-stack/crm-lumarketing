import { desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { BookingDto } from "@/lib/agenda/dto";
import { dayIsoInTz, minutesInTz, partsInTz } from "@/lib/time/slots";
import { getSettings } from "@/server/agenda/settings";

/**
 * 015 — Listado de citas para la UI, con la hora en la zona de quien mira.
 *
 * La forma del registro la dueñe `lib/agenda/dto`, no este archivo: la rejilla y
 * este query apuntan al mismo tipo, así que renombrar un campo rompe la
 * compilación en lugar de dejar `undefined` pintado en la pantalla.
 */

export type ListBookingsOptions = {
  /** Ventana [fromUtc, toUtc) para la vista mensual/semanal. */
  fromUtc?: Date;
  toUtc?: Date;
  /** Solo las de esta persona, más las que no tienen responsable. */
  userId?: string | null;
  /**
   * Zona en la que se etiquetan fecha y hora. Lo pasa la ruta, que ya leyó los
   * settings de quien mira: si la ventana se traduce en una zona y las etiquetas
   * se imprimen en otra, el borde del mes y lo que se ve no cuadran.
   */
  timezone?: string;
};

export async function listBookings(
  organizationId: string,
  opts?: ListBookingsOptions
): Promise<BookingDto[]> {
  const db = getDb();
  const timezone =
    opts?.timezone ?? (await getSettings(organizationId)).timezone;

  const filters: (SQL | undefined)[] = [];
  if (opts?.fromUtc) {
    // Por solape: una reunión que empieza antes de la ventana pero termina
    // dentro también hay que dibujarla.
    filters.push(
      sql`${schema.booking.scheduledAt} + make_interval(mins => ${schema.booking.durationMinutes}) > ${opts.fromUtc.toISOString()}::timestamptz`
    );
  }
  if (opts?.toUtc) filters.push(lt(schema.booking.scheduledAt, opts.toUtc));
  if (opts?.userId) {
    filters.push(
      or(
        eq(schema.booking.userId, opts.userId),
        isNull(schema.booking.userId)
      )
    );
  }

  const rows = await db
    .select({
      booking: schema.booking,
      contactId: schema.contact.id,
      contactName: schema.contact.name,
      assigneeName: schema.user.name,
    })
    .from(schema.booking)
    .leftJoin(schema.contact, eq(schema.booking.contactId, schema.contact.id))
    .leftJoin(schema.user, eq(schema.booking.userId, schema.user.id))
    .where(
      scoped(schema.booking.organizationId, organizationId, ...filters)
    )
    .orderBy(desc(schema.booking.scheduledAt))
    // Con ventana se dibuja un mes completo: 200 se quedan cortos en un
    // negocio ocupado. Sin ventana (la tabla de siempre) basta lo reciente.
    .limit(opts?.fromUtc || opts?.toUtc ? 500 : 200);

  return rows.map((r) => {
    const scheduledAtUtc = r.booking.scheduledAt.toISOString();
    const parts = partsInTz(scheduledAtUtc, timezone);
    // La duración se suma en minutos de pared, no sobre el instante: una cita
    // que cruza la medianoche deja de caber en el día y la vista la recorta.
    const startMinutes = minutesInTz(r.booking.scheduledAt, timezone);
    return {
      id: r.booking.id,
      kind: r.booking.kind as "session" | "block",
      status: r.booking.status as "agendada" | "realizada" | "no_show" | "cancelada",
      source: r.booking.source as BookingDto["source"],
      scheduledAtUtc,
      endsAtUtc: new Date(
        r.booking.scheduledAt.getTime() + r.booking.durationMinutes * 60_000
      ).toISOString(),
      durationMinutes: r.booking.durationMinutes,
      date: parts.date,
      time: parts.time,
      weekday: parts.weekday,
      dayIso: dayIsoInTz(r.booking.scheduledAt, timezone),
      startMinutes,
      endMinutes: startMinutes + r.booking.durationMinutes,
      contact: r.contactId
        ? { id: r.contactId, name: r.contactName ?? "" }
        : null,
      conversationId: r.booking.conversationId,
      title: r.booking.title,
      location: r.booking.location,
      userId: r.booking.userId,
      assigneeName: r.assigneeName ?? null,
      connector: r.booking.connector,
      meetingLink: r.booking.meetingLink,
      linkPending: r.booking.linkPending,
      isTest: r.booking.isTest,
      notes: r.booking.notes,
    };
  });
}
