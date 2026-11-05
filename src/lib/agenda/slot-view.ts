import { dayIsoInTz, dayLabelInTz, minutesInTz, timeInTz } from "@/lib/time/slots";
import type { SlotDto } from "@/lib/agenda/dto";

/**
 * El hueco del motor → lo que pinta la rejilla.
 *
 * Vive en `src/lib` y es puro para que la regla de la medianoche se pueda jurar
 * sin base de datos ni reloj (tests/unit/agenda-huecos.test.ts).
 */

export type RawSlot = { startUtc: string; endUtc: string; label: string };

export function toSlotDto(
  slot: RawSlot,
  timezone: string,
  now: Date = new Date()
): SlotDto {
  const start = new Date(slot.startUtc);
  const startMinutes = minutesInTz(start, timezone);
  // `endMinutes` se SUMA, no se vuelve a leer la hora de `endUtc`: un hueco que
  // termina justo a medianoche daría 0 minutos y la rejilla lo pintaría de
  // tamaño nulo — el mismo criterio que ya usa `listBookings`.
  const duration = Math.round(
    (Date.parse(slot.endUtc) - Date.parse(slot.startUtc)) / 60_000
  );
  return {
    ...slot,
    dayIso: dayIsoInTz(start, timezone),
    dayLabel: dayLabelInTz(slot.startUtc, timezone, now),
    time: timeInTz(slot.startUtc, timezone),
    startMinutes,
    endMinutes: startMinutes + duration,
  };
}
