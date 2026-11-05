/**
 * Los DTOs de la agenda: UN solo dueño de la forma.
 *
 * Viven en `src/lib` porque los dos lados los necesitan —el servidor los
 * construye en `server/agenda/queries.ts` y en `/api/calendar/availability`, la
 * pantalla los lee en `components/agenda/*`— y porque son tipos puros: no
 * arrastran ni `pg` ni React, así que importarlos cruza la frontera cliente/
 * servidor sin llevarse código de más.
 *
 * Antes la pantalla tenía su propio espejo escrito a mano. Ese espejo es justo
 * lo que falla en silencio: si el servidor renombra un campo, la rejilla pinta
 * `undefined` en la etiqueta y ningún `tsc` se entera. Ahora comparten el tipo,
 * así que renombrar rompe la compilación en vez de la pantalla.
 *
 * Regla de zona: `dayIso`, `startMinutes` y `endMinutes` llegan YA convertidos a
 * la zona de quien mira. Ninguna conversión de zona se hace en el navegador, que
 * es como una cita de las 9 se plantaba a las 15 según dónde estuviera el
 * operador.
 */

export type BookingStatus = "agendada" | "realizada" | "no_show" | "cancelada";

export type BookingDto = {
  id: string;
  kind: "session" | "block";
  status: BookingStatus;
  source: "manual" | "ai";
  scheduledAtUtc: string;
  /** Fin de la cita en UTC: la vista necesita el intervalo, no solo el inicio. */
  endsAtUtc: string;
  durationMinutes: number;
  date: string;
  time: string;
  weekday: string;
  /**
   * Día ISO (YYYY-MM-DD) EN LA ZONA DE QUIEN MIRA: la clave con la que la vista
   * agrupa. Existe porque `date` es una etiqueta («5 ago 2026»), no una fecha
   * comparable, y volver a convertir en el navegador usaría la zona local.
   */
  dayIso: string;
  /** Minutos desde la medianoche de ese día. `endMinutes` pasa de 1440 si cruza. */
  startMinutes: number;
  endMinutes: number;
  contact: { id: string; name: string } | null;
  conversationId: string | null;
  /** Motivo escrito por quien creó la cita; null ⇒ «Cita». */
  title: string | null;
  /** Lugar o modalidad. */
  location: string | null;
  /** Quién atiende; null ⇒ cita del negocio, sin responsable. */
  userId: string | null;
  assigneeName: string | null;
  /** Con qué conector nació la entrega de esta cita. */
  connector: string | null;
  meetingLink: string | null;
  /** El proveedor falló al crear la reunión: se puede reintentar. */
  linkPending: boolean;
  isTest: boolean;
  notes: string | null;
};

/** Un hueco libre del horario de quien mira, listo para pintar. */
export type SlotDto = {
  startUtc: string;
  endUtc: string;
  label: string;
  dayIso: string;
  dayLabel: string;
  time: string;
  /** Minutos de pared desde la medianoche del `dayIso`, en la zona de quien mira. */
  startMinutes: number;
  /**
   * `startMinutes` + lo que dura el hueco. Se suma, NO se vuelve a leer la hora
   * de `endUtc`: un hueco que termina a medianoche daría 0 y la rejilla lo
   * dibujaría de tamaño nulo.
   */
  endMinutes: number;
};
