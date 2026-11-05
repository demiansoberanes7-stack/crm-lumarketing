/**
 * El modelo de la vista de Citas, puro.
 *
 * Vive separado del componente por dos razones: todas las cuentas de calendario
 * (qué día entra en la rejilla de un mes, qué ventana pedir a la API, cómo se
 * recorta un bloque que cruza la medianoche) se pueden probar sin navegador, y
 * porque la única fuente de verdad de las fechas es la que ya fija
 * `dayIsoInTz`/`minutesInTz` en el servidor. Aquí no se construye un `Date` con
 * la zona del navegador ni una vez: se opera sobre cadenas `YYYY-MM-DD` y
 * minutos de pared, que es exactamente lo que la API devuelve.
 */

import { addDaysISO } from "@/lib/time/slots";

export type AgendaView = "month" | "week" | "day";

/** Lun…dom, el orden en que se pinta la rejilla. */
export const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

const MINUTES_PER_DAY = 1440;

function utcOf(dayISO: string): number {
  return Date.parse(`${dayISO}T00:00:00Z`);
}

/** 0 = lunes … 6 = domingo. Aritmética de calendario, sin zona del navegador. */
export function weekdayIndexOf(dayISO: string): number {
  const ts = utcOf(dayISO);
  if (Number.isNaN(ts)) return 0;
  return (new Date(ts).getUTCDay() + 6) % 7;
}

export function startOfWeekISO(dayISO: string): string {
  return addDaysISO(dayISO, -weekdayIndexOf(dayISO));
}

export function monthStartISO(dayISO: string): string {
  return `${dayISO.slice(0, 7)}-01`;
}

export function monthEndISO(dayISO: string): string {
  const [year, month] = dayISO.slice(0, 7).split("-").map(Number);
  // El día 0 del mes siguiente es el último del mes pedido.
  const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return `${dayISO.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/**
 * Suma meses conservando el día cuando cabe.
 *
 * `2026-01-31` + 1 mes ⇒ `2026-02-28`, no `2026-03-03`. Con la aritmética
 * ingenua sobre `Date` (o con `setMonth`) pulsar «siguiente» terminaba en un mes
 * distinto del que se lee en la etiqueta.
 */
export function addMonthsISO(dayISO: string, delta: number): string {
  if (Number.isNaN(utcOf(dayISO))) return dayISO;
  const year = Number(dayISO.slice(0, 4));
  const day = Number(dayISO.slice(8, 10));
  const shifted = Number(dayISO.slice(5, 7)) - 1 + delta;
  const y = year + Math.floor(shifted / 12);
  const m = ((shifted % 12) + 12) % 12; // 0-based, siempre positivo
  const maxDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return (
    `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-` +
    String(Math.min(day, maxDay)).padStart(2, "0")
  );
}

/** Mover el ancla según la vista activa: un mes, una semana o un día. */
export function shiftISO(
  anchor: string,
  view: AgendaView,
  delta: number
): string {
  if (view === "month") return addMonthsISO(anchor, delta);
  return addDaysISO(anchor, delta * (view === "week" ? 7 : 1));
}

/** Los 42 días (6 semanas, empiezan en lunes) que cubren el mes del ancla. */
export function monthDaysISO(anchor: string): string[] {
  const first = startOfWeekISO(monthStartISO(anchor));
  return Array.from({ length: 42 }, (_, i) => addDaysISO(first, i));
}

/** Los siete días de la semana del ancla, empezando en lunes. */
export function weekDaysISO(anchor: string): string[] {
  const first = startOfWeekISO(anchor);
  return Array.from({ length: 7 }, (_, i) => addDaysISO(first, i));
}

/** La ventana inclusiva [from, to] que hay que pedir para pintar la vista. */
export function rangeForView(
  anchor: string,
  view: AgendaView
): { from: string; to: string } {
  if (view === "month") {
    return { from: monthStartISO(anchor), to: monthEndISO(anchor) };
  }
  if (view === "week") {
    const days = weekDaysISO(anchor);
    return { from: days[0]!, to: days[days.length - 1]! };
  }
  return { from: anchor, to: anchor };
}

const asUtc = (dayISO: string): Date => {
  const ts = utcOf(dayISO);
  return new Date(Number.isNaN(ts) ? 0 : ts);
};
const MONTH_FMT = new Intl.DateTimeFormat("es-MX", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH_NAME_FMT = new Intl.DateTimeFormat("es-MX", {
  month: "long",
  timeZone: "UTC",
});
const DAY_FMT = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function monthLabelISO(dayISO: string): string {
  return MONTH_FMT.format(asUtc(dayISO));
}
export function dayLabelFullISO(dayISO: string): string {
  return DAY_FMT.format(asUtc(dayISO));
}

/** Etiqueta del rango que encabeza la vista: es lo que el usuario está moviendo. */
export function rangeLabel(anchor: string, view: AgendaView): string {
  if (view === "month") return monthLabelISO(anchor);
  if (view === "day") return dayLabelFullISO(anchor);
  const days = weekDaysISO(anchor);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const fromDay = Number(from.slice(8, 10));
  const toDay = Number(to.slice(8, 10));
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${fromDay}–${toDay} de ${MONTH_NAME_FMT.format(asUtc(from))} ${from.slice(0, 4)}`;
  }
  return (
    `${fromDay} de ${MONTH_NAME_FMT.format(asUtc(from))} – ` +
    `${toDay} de ${MONTH_NAME_FMT.format(asUtc(to))} ${to.slice(0, 4)}`
  );
}

export type Dated = { dayIso: string };

/** Agrupa por día ISO. Sin clave no hay fila: un día vacío se pinta vacío. */
export function groupByDay<T extends Dated>(items: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    (out[item.dayIso] ??= []).push(item);
  }
  return out;
}

export function countByDay<T extends Dated>(
  items: T[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    out[item.dayIso] = (out[item.dayIso] ?? 0) + 1;
  }
  return out;
}

export type Timed = { startMinutes: number; endMinutes: number };

/**
 * Rango de horas de la rejilla semanal/diaria.
 *
 * Sale de LO QUE SE VIÓ (citas + huecos libres) con un suelo razonable: sin
 * datos, una jornada de 8 a 18 en vez de 24 renglones vacíos.
 */
export function hoursRange(
  items: Timed[],
  fallback: [number, number] = [8, 18]
): { hours: number[] } {
  let lo = fallback[0];
  let hi = fallback[1];
  for (const it of items) {
    lo = Math.min(lo, Math.floor(it.startMinutes / 60));
    hi = Math.max(hi, Math.ceil(it.endMinutes / 60));
  }
  const firstHour = Math.max(0, Math.min(23, lo));
  const lastHour = Math.max(firstHour + 1, Math.min(24, hi));
  return {
    hours: Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i),
  };
}

/**
 * Recorta un intervalo al día que se pinta.
 * `null` = no pertenece a este día (empezó antes de la medianoche o ya terminó).
 */
export function clipToDay(
  block: Timed
): { topMinutes: number; heightMinutes: number } | null {
  const start = Math.max(0, Math.min(MINUTES_PER_DAY, block.startMinutes));
  const end = Math.max(0, Math.min(MINUTES_PER_DAY, block.endMinutes));
  if (end <= start) return null;
  return { topMinutes: start, heightMinutes: end - start };
}

/** Tono con el que se pinta un bloque: el estado es contrato visible. */
export type BlockTone =
  | "agendada"
  | "realizada"
  | "no_show"
  | "cancelada"
  | "bloqueo"
  | "libre";

export function toneFor(booking: {
  kind: "session" | "block";
  status: "agendada" | "realizada" | "no_show" | "cancelada";
}): BlockTone {
  return booking.kind === "block" ? "bloqueo" : booking.status;
}

/** «14:30» desde minutos de pared. */
export function hhmm(minutes: number): string {
  const m = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutos desde la medianoche para un `HH:MM` de pared; null si no es hora. */
export function minutesOfHHMM(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Fin dado el inicio y la duración.
 *
 * `23:45 + 60` se queda en `23:59`: un `<input type="time">` no representa la
 * medianoche del día siguiente, y mostrar «00:45» invitaría a guardar una cita
 * que termina antes de empezar.
 */
export function endHHMM(startHHMM: string, durationMinutes: number): string {
  const start = minutesOfHHMM(startHHMM);
  if (start === null) return "";
  return hhmm(start + durationMinutes);
}

/**
 * Duración a partir de «inicio → fin», o null si el fin no es posterior.
 * El formulario muestra el error en vez de agendar una cita negativa.
 */
export function durationFromRange(
  startHHMM: string,
  endHHMMValue: string
): number | null {
  const a = minutesOfHHMM(startHHMM);
  const b = minutesOfHHMM(endHHMMValue);
  if (a === null || b === null || b <= a) return null;
  return b - a;
}
