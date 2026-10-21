/**
 * Periodos del negocio cortados por día local, no por día UTC.
 *
 * El contenedor corre en UTC y el negocio en la Ciudad de México (UTC-6): con
 * `new Date().toISOString()` a las 20:00 del último día del mes ya era el día 1
 * del mes siguiente, así que Balance abría en el mes equivocado y el dueño leía
 * «sin ingresos este mes» cuando el mes seguía en curso.
 */
export const BUSINESS_TIMEZONE = "America/Mexico_City";

/** `YYYY-MM-DD` de hoy en la zona del negocio (compatible con `<input type="date">`). */
export function zonedDateInput(now: Date = new Date(), timeZone = BUSINESS_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Primer y último día (`YYYY-MM-DD`) del mes en curso en la zona del negocio. */
export function zonedMonthBounds(
  now: Date = new Date(),
  timeZone = BUSINESS_TIMEZONE
): { from: string; to: string } {
  const today = zonedDateInput(now, timeZone);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(lastDay)}` };
}
