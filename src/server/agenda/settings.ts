import { eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { safeHttpUrl } from "@/lib/safe-url";
import { scoped } from "@/lib/db/tenant";
import {
  DEFAULT_CONNECTOR,
  isConnectorId,
  type ConnectorId,
} from "@/lib/agenda-connectors";
import {
  isValidInterval,
  isValidTimeZone,
  WEEKDAYS,
  type Interval,
  type WeekdayKey,
} from "@/lib/time/slots";

/**
 * 015 — La configuración de la agenda.
 *
 * Desde 0087 hay dos niveles en la misma tabla: la fila del negocio
 * (`user_id IS NULL`) y, opcionalmente, una fila por usuario. La lectura es la
 * cascada usuario → negocio → defaults, y la escritura admite los dos niveles.
 */

export type WeeklyHours = Partial<Record<WeekdayKey, Interval[]>>;

export const DEFAULT_TIMEZONE = "America/Mexico_City";

/** L-V 09:00-18:00 — se ajusta en Ajustes → Agenda. */
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  mon: [{ start: "09:00", end: "18:00" }],
  tue: [{ start: "09:00", end: "18:00" }],
  wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }],
  fri: [{ start: "09:00", end: "18:00" }],
};

export type CalendarSettings = {
  weeklyHours: WeeklyHours;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  timezone: string;
  /** Cómo se entrega la reunión. */
  connector: ConnectorId;
  /** Sala fija del conector `enlace-fijo`; null ⇒ citas sin link. */
  meetingLink: string | null;
};

/** Lo que ve una instancia recién encendida: útil sin configurar nada. */
export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  weeklyHours: DEFAULT_WEEKLY_HOURS,
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 2,
  maxDaysAhead: 7,
  timezone: DEFAULT_TIMEZONE,
  connector: DEFAULT_CONNECTOR,
  meetingLink: null,
};

export const LIMITS = {
  slotMinutes: { min: 10, max: 240 },
  bufferMinutes: { min: 0, max: 120 },
  minNoticeHours: { min: 0, max: 72 },
  maxDaysAhead: { min: 1, max: 60 },
} as const;

type SettingsRow = typeof schema.calendarSettings.$inferSelect;

/** Lo que puede ser distinto para cada persona: cuándo está disponible. */
type SchedulingFields = Pick<
  CalendarSettings,
  "weeklyHours" | "slotMinutes" | "bufferMinutes" | "minNoticeHours" | "maxDaysAhead" | "timezone"
>;

/** Lo que decide el NEGOCIO aunque lo lea un usuario: cómo se entrega la reunión. */
type DeliveryFields = Pick<CalendarSettings, "connector" | "meetingLink">;

function schedulingOf(row: SettingsRow): SchedulingFields {
  return {
    weeklyHours: normalizeWeeklyHours(row.weeklyHours as WeeklyHours),
    slotMinutes: row.slotMinutes,
    bufferMinutes: row.bufferMinutes,
    minNoticeHours: row.minNoticeHours,
    maxDaysAhead: row.maxDaysAhead,
    timezone: row.timezone,
  };
}

function deliveryOf(row: SettingsRow): DeliveryFields {
  return {
    // Un conector que ya no existe en el código (p. ej. venías de un fork) no
    // puede dejar la agenda inservible: se degrada al soberano.
    connector: isConnectorId(row.connector) ? row.connector : DEFAULT_CONNECTOR,
    meetingLink: row.meetingLink,
  };
}

/**
 * Horarios de trabajo de `userId`, con la entrega de reunión del negocio.
 *
 * La separación no es un detalle: si la fila personal trajera el conector, un
 * usuario que solo quiso cambiar sus horas —y cuya fila nació con el default
 * `enlace-fijo`— dejaría de generar enlaces Meet para toda la organización.
 * Las credenciales y la sala son del negocio; las horas son de cada quien.
 */
export async function getSettings(
  organizationId: string,
  userId?: string | null
): Promise<CalendarSettings> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.calendarSettings)
    .where(
      scoped(
        schema.calendarSettings.organizationId,
        organizationId,
        userId
          ? or(
              eq(schema.calendarSettings.userId, userId),
              isNull(schema.calendarSettings.userId)
            )
          : isNull(schema.calendarSettings.userId)
      )
    );

  const business = rows.find((r) => r.userId === null) ?? null;
  const personal = userId ? rows.find((r) => r.userId === userId) ?? null : null;

  // Sin ninguna fila: la instancia recién encendida ya es usable.
  if (!business && !personal) return DEFAULT_CALENDAR_SETTINGS;
  const base = business ?? personal!;
  return { ...schedulingOf(personal ?? base), ...deliveryOf(base) };
}

export class CalendarSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarSettingsError";
  }
}

/**
 * Lo que llega de fuera, antes de normalizar: el horario y el conector vienen
 * sueltos porque su validación vive AQUÍ. Si el tipo estricto se exigiera en la
 * ruta, cada llamador tendría que hacer un cast — y un cast es justamente la
 * comprobación que no ocurre.
 */
export type CalendarSettingsInput = Partial<
  Omit<CalendarSettings, "weeklyHours" | "connector">
> & {
  weeklyHours?: unknown;
  connector?: string;
};

/**
 * Guarda la fila del negocio (`userId` omitido) o la de una persona.
 *
 * Al guardar la fila personal se parte de lo que esa persona ya vería (la
 * cascada de `getSettings`), así que tocar solo el horario no reinicia los
 * minutos de slot ni la zona al default de la columna: lo que no se envía se
 * hereda y queda materializado en la fila.
 */
export async function upsertSettings(
  organizationId: string,
  input: CalendarSettingsInput,
  userId?: string | null
): Promise<CalendarSettings> {
  const current = await getSettings(organizationId, userId);

  const timezone = input.timezone ?? current.timezone;
  // Una zona desconocida rompería el motor entero: se rechaza al guardar.
  if (!isValidTimeZone(timezone)) {
    throw new CalendarSettingsError(`Zona horaria desconocida: ${timezone}`);
  }

  const connector = input.connector ?? current.connector;
  if (!isConnectorId(connector)) {
    throw new CalendarSettingsError(`Conector desconocido: ${connector}`);
  }

  const next: CalendarSettings = {
    weeklyHours: normalizeWeeklyHours(
      input.weeklyHours !== undefined ? input.weeklyHours : current.weeklyHours
    ),
    slotMinutes: clampInt(
      input.slotMinutes ?? current.slotMinutes,
      LIMITS.slotMinutes.min,
      LIMITS.slotMinutes.max
    ),
    bufferMinutes: clampInt(
      input.bufferMinutes ?? current.bufferMinutes,
      LIMITS.bufferMinutes.min,
      LIMITS.bufferMinutes.max
    ),
    minNoticeHours: clampInt(
      input.minNoticeHours ?? current.minNoticeHours,
      LIMITS.minNoticeHours.min,
      LIMITS.minNoticeHours.max
    ),
    maxDaysAhead: clampInt(
      input.maxDaysAhead ?? current.maxDaysAhead,
      LIMITS.maxDaysAhead.min,
      LIMITS.maxDaysAhead.max
    ),
    timezone,
    connector,
    meetingLink: normalizeLink(
      input.meetingLink !== undefined ? input.meetingLink : current.meetingLink
    ),
  };

  const db = getDb();
  const values = {
    weeklyHours: next.weeklyHours,
    slotMinutes: next.slotMinutes,
    bufferMinutes: next.bufferMinutes,
    minNoticeHours: next.minNoticeHours,
    maxDaysAhead: next.maxDaysAhead,
    timezone: next.timezone,
    connector: next.connector,
    meetingLink: next.meetingLink,
  };
  await db
    .insert(schema.calendarSettings)
    .values({
      id: newId("calendarSettings"),
      organizationId,
      userId: userId ?? null,
      ...values,
    })
    .onConflictDoUpdate({
      target: [schema.calendarSettings.organizationId, schema.calendarSettings.userId],
      set: { ...values, updatedAt: new Date() },
    });

  return next;
}

/**
 * Descarta intervalos inválidos y días vacíos (día cerrado) y ordena por hora
 * de inicio. Se prefiere limpiar a rechazar: un día mal escrito no debe tumbar
 * el guardado completo del horario.
 */
export function normalizeWeeklyHours(input: unknown): WeeklyHours {
  const out: WeeklyHours = {};
  if (typeof input !== "object" || input === null) return out;
  const source = input as Record<string, unknown>;
  for (const day of WEEKDAYS) {
    const intervals = source[day];
    if (!Array.isArray(intervals)) continue;
    const valid = intervals
      .filter(isValidInterval)
      .sort((a, b) => a.start.localeCompare(b.start));
    if (valid.length > 0) out[day] = valid;
  }
  return out;
}

/**
 * Cadena vacía o espacios ⇒ null (el campo es opcional de verdad).
 *
 * Lo que no es HTTP(S) tampoco se guarda. `meetingLink` acaba en un `href` de
 * la pantalla de Citas (`bookings-client.tsx`) y en el mensaje con el que el
 * agente le manda el enlace al cliente; `PUT /api/calendar/settings` es
 * `withAuth`, así que cualquier miembro —no solo el dueño— podía escribir
 * `javascript:…` y que otro lo ejecutara con su propia sesión al hacer clic.
 */
export function normalizeLink(link: string | null | undefined): string | null {
  return safeHttpUrl(link);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
