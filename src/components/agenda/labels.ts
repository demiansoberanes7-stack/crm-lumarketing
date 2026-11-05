/**
 * El texto español de los estados de cita.
 *
 * Los DTOs ya no viven aquí: son `BookingDto` y `SlotDto` en
 * `src/lib/agenda/dto.ts`, compartidos con el servidor que los construye. Tener
 * aquí un espejo escrito a mano era la forma fácil de que la pantalla se
 * quedara pintando `undefined` después de un cambio de campo.
 */

import type { BookingStatus } from "@/lib/agenda/dto";

export const STATUS_LABEL: Record<BookingStatus, string> = {
  agendada: "Agendada",
  realizada: "Realizada",
  no_show: "No asistió",
  cancelada: "Cancelada",
};
