import { and, inArray, lt, ne, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  addDaysISO,
  eachDateInRange,
  expandWorkingDayToUtc,
  labelInTz,
  overlaps,
  todayInTz,
  weekdayKeyOf,
  zonedWallClockToUtc,
  type SlotUtc,
} from "@/lib/time/slots";
import { getSettings, type CalendarSettings } from "@/server/agenda/settings";

/**
 * 015 — Motor de disponibilidad:
 *   horario semanal − citas activas − bloqueos manuales.
 *
 * Desde 0087 el horario puede ser de una persona (`userId`): la cascada
 * usuario → negocio → defaults vive en `getSettings`. La EXCLUSIVIDAD del hueco
 * sigue siendo del negocio —si un compañero tiene una cita ahí, ese instante no
 * está libre para nadie—, porque el invariante que ya protege el índice único
 * parcial es el que evita citar a dos clientes en el mismo momento.
 *
 * Limitación v1 documentada (Constitución VII): NO lee calendarios externos.
 * Es una decisión, no un olvido: meter al proveedor en este camino acoplaría su
 * latencia y sus caídas a la pantalla que más se usa. Los compromisos de fuera
 * se reflejan con bloqueos manuales.
 */

export type AvailableSlot = SlotUtc & { label: string };

/**
 * PURA: expande el horario semanal a slots candidatos en UTC. Sin BD, sin
 * reloj — se testea sola (tests/unit/availability.test.ts).
 */
export function buildCandidateSlots(
  settings: CalendarSettings,
  fromISO: string,
  toISO: string,
  durationMinutes?: number
): SlotUtc[] {
  const tz = settings.timezone;
  const candidates: SlotUtc[] = [];
  for (const date of eachDateInRange(fromISO, toISO)) {
    const weekday = weekdayKeyOf(date, tz);
    if (!weekday) continue;
    const intervals = settings.weeklyHours[weekday] ?? [];
    if (intervals.length === 0) continue; // día cerrado
    candidates.push(
      ...expandWorkingDayToUtc(
        date,
        intervals,
        tz,
        settings.slotMinutes,
        settings.bufferMinutes,
        durationMinutes ?? settings.slotMinutes
      )
    );
  }
  return candidates;
}

/**
 * PURA: descarta lo que ya pasó (con aviso mínimo) y lo que se solapa con algo
 * ocupado, ordena y etiqueta.
 */
export function filterFreeSlots(
  candidates: SlotUtc[],
  busy: SlotUtc[],
  opts: { now: Date; minNoticeHours: number; timezone: string }
): AvailableSlot[] {
  const minStartMs = opts.now.getTime() + opts.minNoticeHours * 3_600_000;
  return candidates
    .filter((c) => Date.parse(c.startUtc) >= minStartMs)
    .filter(
      (c) =>
        !busy.some((b) => overlaps(c.startUtc, c.endUtc, b.startUtc, b.endUtc))
    )
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
    .map((c) => ({ ...c, label: labelInTz(c.startUtc, opts.timezone) }));
}

export async function computeAvailability(
  organizationId: string,
  opts?: {
    fromISO?: string;
    toISO?: string;
    excludeBookingId?: string;
    now?: Date;
    settings?: CalendarSettings;
    /** Huecos de ESTA persona; sin valor, los del negocio. */
    userId?: string | null;
    /** Duración de la reunión buscada; por defecto la rejilla configurada. */
    durationMinutes?: number;
  }
): Promise<AvailableSlot[]> {
  const settings =
    opts?.settings ?? (await getSettings(organizationId, opts?.userId));
  const now = opts?.now ?? new Date();
  const tz = settings.timezone;
  const duration = opts?.durationMinutes ?? settings.slotMinutes;

  const from = opts?.fromISO ?? todayInTz(now, tz);
  const to = opts?.toISO ?? addDaysISO(from, settings.maxDaysAhead);

  const candidates = buildCandidateSlots(settings, from, to, duration);
  if (candidates.length === 0) return [];

  const busy = await getBusyIntervals(organizationId, {
    fromUtc: zonedWallClockToUtc(from, "00:00", tz) ?? new Date(0),
    toUtc:
      zonedWallClockToUtc(addDaysISO(to, 1), "00:00", tz) ??
      new Date(now.getTime() + 86_400_000 * 61),
    excludeBookingId: opts?.excludeBookingId,
  });

  return filterFreeSlots(candidates, busy, {
    now,
    minNoticeHours: settings.minNoticeHours,
    timezone: tz,
  });
}

/**
 * Re-valida que un instante concreto siga libre. Se llama AL CONFIRMAR, nunca
 * al ofrecer. `excludeBookingId` permite reprogramar sin que la propia cita se
 * bloquee a sí misma.
 *
 * Solo recalcula ±1 día alrededor del instante pedido.
 *
 * OJO: esto reduce la ventana de la carrera, no la cierra — entre este SELECT
 * y el INSERT cabe otra confirmación. Quien cierra de verdad es el índice
 * único parcial de `booking` (research D7); esto existe para dar una respuesta
 * útil (con alternativas) en el caso normal.
 */
export async function findSlot(
  organizationId: string,
  whenISO: string,
  opts?: {
    excludeBookingId?: string;
    now?: Date;
    settings?: CalendarSettings;
    userId?: string | null;
    durationMinutes?: number;
  }
): Promise<AvailableSlot | null> {
  const target = Date.parse(whenISO);
  if (Number.isNaN(target)) return null;

  const settings =
    opts?.settings ?? (await getSettings(organizationId, opts?.userId));
  const dayInTz = todayInTz(new Date(target), settings.timezone);

  const slots = await computeAvailability(organizationId, {
    fromISO: addDaysISO(dayInTz, -1),
    toISO: addDaysISO(dayInTz, 1),
    excludeBookingId: opts?.excludeBookingId,
    now: opts?.now,
    settings,
    durationMinutes: opts?.durationMinutes,
  });
  return slots.find((s) => Date.parse(s.startUtc) === target) ?? null;
}

/**
 * Lo que ya está ocupado en [fromUtc, toUtc).
 *
 * Se filtra por SOLAPE, no por «empieza dentro de la ventana»: una cita de 60
 * minutos que arranca un cuarto de hora antes del borde izquierdo sí invade la
 * ventana, y con `between` en `scheduledAt` era invisible. Con duraciones
 * distintas de la rejilla —que es justo lo que se pidió— ese caso deja de ser
 * teórico.
 */
async function getBusyIntervals(
  organizationId: string,
  input: { fromUtc: Date; toUtc: Date; excludeBookingId?: string }
): Promise<SlotUtc[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.booking.id,
      scheduledAt: schema.booking.scheduledAt,
      durationMinutes: schema.booking.durationMinutes,
    })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          // Canceladas y no-show liberan el hueco.
          inArray(schema.booking.status, ["agendada", "realizada"]),
          // Sandbox: una cita de prueba no consume la agenda real.
          eq(schema.booking.isTest, false),
          lt(schema.booking.scheduledAt, input.toUtc),
          sql`${schema.booking.scheduledAt} + make_interval(mins => ${schema.booking.durationMinutes}) > ${input.fromUtc}`
        )
      )
    );

  return rows
    .filter((r) => r.id !== input.excludeBookingId)
    .map((r) => ({
      startUtc: r.scheduledAt.toISOString(),
      endUtc: new Date(
        r.scheduledAt.getTime() + r.durationMinutes * 60_000
      ).toISOString(),
    }));
}

type AgendaTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Candado por negocio que serializa «leer el hueco → escribir la cita».
 *
 * El índice único parcial de `booking` solo cierra el choque EXACTO de dos
 * inserciones en el mismo instante; una reunión de 60 que cae a caballo de dos
 * slots de 30 no choca con ninguna llave. El lock se pide con
 * `pg_advisory_xact_lock`, así que se suelta solo al cerrar la transacción y no
 * puede quedar colgado si el proceso se cae. Es el mismo candado que ya usan
 * cotizaciones, proyectos y órdenes de servicio.
 */
export async function lockBookingSlots(
  tx: AgendaTx,
  organizationId: string
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:booking_slot`}))`
  );
}

/**
 * ¿Algo ocupa ya [startUtc, endUtc)? El MISMO criterio que `getBusyIntervals`
 * (activas, fuera de sandbox, por solape), dentro de la transacción y con el
 * candado arriba puesto. Devuelve el id que estorba, o null.
 */
export async function findSlotClash(
  tx: AgendaTx,
  organizationId: string,
  input: { startUtc: Date; endUtc: Date; excludeBookingId?: string }
): Promise<string | null> {
  const rows = await tx
    .select({ id: schema.booking.id })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          inArray(schema.booking.status, ["agendada", "realizada"]),
          eq(schema.booking.isTest, false),
          lt(schema.booking.scheduledAt, input.endUtc),
          sql`${schema.booking.scheduledAt} + make_interval(mins => ${schema.booking.durationMinutes}) > ${input.startUtc}`,
          ...(input.excludeBookingId
            ? [ne(schema.booking.id, input.excludeBookingId)]
            : [])
        )
      )
    )
    .limit(1);
  return rows[0]?.id ?? null;
}
