import { describe, expect, it } from "vitest";
import { toSlotDto } from "@/lib/agenda/slot-view";
import { clipToDay } from "@/lib/agenda/view-model";

/**
 * La fila que la rejilla pinta de cada hueco libre.
 *
 * El caso que importa es el hueco que TERMINA a medianoche: leer la hora de
 * `endUtc` devuelve 0 minutos, y un bloque de `start` a `0` no se dibuja — el
 * operador vería su agenda con un agujero silencioso justo a las 24:00. Por eso
 * `endMinutes` se SUMA, igual que en `listBookings`.
 *
 * Zonas fijas, no el reloj de donde corre Vitest: CDMX es UTC-6 todo el año
 * (sin horario de verano desde 2022) y Bogotá UTC-5.
 */

const MX = "America/Mexico_City";
const now = new Date("2026-08-01T12:00:00.000Z");

describe("toSlotDto", () => {
  it("un hueco de la tarde: día, minutos y etiqueta de pared", () => {
    // 17:30 de CDMX = 23:30 UTC del mismo día.
    const s = toSlotDto(
      {
        startUtc: "2026-08-05T23:30:00.000Z",
        endUtc: "2026-08-06T00:00:00.000Z",
        label: "5/08 17:30",
      },
      MX,
      now
    );
    expect(s.dayIso).toBe("2026-08-05");
    expect(s.startMinutes).toBe(1050);
    expect(s.endMinutes).toBe(1080);
    expect(s.time).toBe("17:30");
    expect(s.label).toBe("5/08 17:30");
  });

  it("el hueco que acaba a medianoche no se pinta de tamaño cero", () => {
    // 23:30 → 00:00 de CDMX: la hora de `endUtc` leída sola sería 0.
    const s = toSlotDto(
      {
        startUtc: "2026-08-06T05:30:00.000Z",
        endUtc: "2026-08-06T06:00:00.000Z",
        label: "5/08 23:30",
      },
      MX,
      now
    );
    expect(s.dayIso).toBe("2026-08-05");
    expect(s.startMinutes).toBe(1410);
    expect(s.endMinutes).toBe(1440);
    // Y la rejilla lo puede dibujar: recortado al día, con altura positiva.
    expect(clipToDay(s)).toEqual({ topMinutes: 1410, heightMinutes: 30 });
  });

  it("el mismo instante, en otra zona, es otro hueco de pared", () => {
    const s = {
      startUtc: "2026-08-05T14:00:00.000Z",
      endUtc: "2026-08-05T14:30:00.000Z",
      label: "",
    };
    // 08:00 en Ciudad de México, 09:00 en Bogotá.
    expect(toSlotDto(s, MX, now).startMinutes).toBe(480);
    expect(toSlotDto(s, "America/Bogota", now).startMinutes).toBe(540);
  });
});
