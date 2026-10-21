import { describe, expect, it } from "vitest";
import { citaStartUtc } from "@/components/bookings/bookings-client";

/**
 * El instante que manda el formulario de «Nueva cita».
 *
 * Vale la pena jurarlo aparte porque es la única forma de que una cita creada
 * a mano llegue corrida de hora: un hueco de la disponibilidad ya viene en UTC,
 * pero el `datetime-local` del navegador escribe la hora del operador SIN zona.
 * Si ese texto viajara crudo, el servidor lo leería como UTC y la cita caería
 * 6 horas antes en Ciudad de México.
 */

describe("citaStartUtc", () => {
  it("un hueco de la disponibilidad viaja tal cual", () => {
    expect(citaStartUtc("hueco", "2026-10-22T15:00:00.000Z", "")).toBe(
      "2026-10-22T15:00:00.000Z"
    );
  });

  it("sin hueco elegido no hay instante, aunque haya texto en el otro campo", () => {
    expect(citaStartUtc("hueco", "", "2026-10-22T09:00")).toBeNull();
  });

  it("«otra hora» vacía o ilegible no manda nada", () => {
    expect(citaStartUtc("otra", "2026-10-22T15:00:00.000Z", "")).toBeNull();
    expect(citaStartUtc("otra", "", "no-es-fecha")).toBeNull();
  });

  /**
   * Se compara contra el constructor de hora local —no contra una cadena fija—
   * para que la prueba valga igual en el CI (UTC) y en el portátil de alguien
   * en otra zona.
   */
  it("la hora tecleada se interpreta en la zona del navegador", () => {
    expect(citaStartUtc("otra", "", "2026-10-22T09:00")).toBe(
      new Date(2026, 9, 22, 9, 0).toISOString()
    );
  });
});
