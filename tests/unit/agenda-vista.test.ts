import { describe, expect, it } from "vitest";

/**
 * FASE 3 · A3 — Las cuentas de la vista de Citas.
 *
 * Aquí vive el riesgo silencioso del calendario: un mes que empieza en el día
 * equivocado, un «siguiente» que salta a marzo desde el 31 de enero, o un bloque
 * que cruza la medianoche y se dibuja de arriba hacia abajo. Nada de eso se ve
 * en un typecheck, y en el navegador depende de la zona horaria de quien mira.
 *
 * Estas funciones operan SOLO con cadenas `YYYY-MM-DD` y minutos de pared, así
 * que se pueden probar sin Intl ni reloj: la conversión de zona ya la hizo el
 * servidor (`dayIsoInTz`/`minutesInTz`) y está cubierta en availability.test.ts.
 */

import {
  addMonthsISO,
  clipToDay,
  countByDay,
  durationFromRange,
  endHHMM,
  groupByDay,
  hhmm,
  hoursRange,
  minutesOfHHMM,
  monthDaysISO,
  monthEndISO,
  rangeForView,
  rangeLabel,
  shiftISO,
  startOfWeekISO,
  toneFor,
  weekDaysISO,
  weekdayIndexOf,
} from "@/lib/agenda/view-model";

describe("el ancla de la rejilla", () => {
  it("empieza la semana en lunes (2026-08-05 es miércoles)", () => {
    expect(weekdayIndexOf("2026-08-03")).toBe(0); // lunes
    expect(weekdayIndexOf("2026-08-05")).toBe(2); // miércoles
    expect(weekdayIndexOf("2026-08-09")).toBe(6); // domingo
    expect(startOfWeekISO("2026-08-05")).toBe("2026-08-03");
    expect(startOfWeekISO("2026-08-09")).toBe("2026-08-03");
  });

  it("la rejilla mensual cubre el mes entero, aunque el día 1 caiga a mitad de semana", () => {
    // Agosto 2026 empieza en domingo: la rejilla arranca el lunes 27 de julio.
    const days = monthDaysISO("2026-08-15");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-07-27");
    expect(days).toContain("2026-08-01");
    expect(days).toContain("2026-08-31");
    expect(days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true);
  });

  it("el fin de mes sabe si es bisiesto", () => {
    expect(monthEndISO("2026-02-09")).toBe("2026-02-28");
    expect(monthEndISO("2028-02-09")).toBe("2028-02-29");
    expect(monthEndISO("2026-04-30")).toBe("2026-04-30");
    expect(monthEndISO("2026-12-01")).toBe("2026-12-31");
  });

  it("la semana son siete días consecutivos desde el lunes", () => {
    const days = weekDaysISO("2026-08-09");
    expect(days).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
  });
});

describe("moverse por el calendario", () => {
  it("un mes hacia adelante conserva el día cuando cabe", () => {
    expect(addMonthsISO("2026-08-15", 1)).toBe("2026-09-15");
    expect(addMonthsISO("2026-08-15", -1)).toBe("2026-07-15");
    expect(addMonthsISO("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonthsISO("2027-01-15", -1)).toBe("2026-12-15");
  });

  it("el 31 de enero no se desliza a marzo", () => {
    expect(addMonthsISO("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsISO("2026-03-31", -1)).toBe("2026-02-28");
    // …y al volver, recupera el mes, no se queda desplazado.
    expect(addMonthsISO("2026-02-28", 1)).toBe("2026-03-28");
  });

  it("cada vista avanza el paso que le toca", () => {
    expect(shiftISO("2026-08-05", "day", 1)).toBe("2026-08-06");
    expect(shiftISO("2026-08-05", "week", 1)).toBe("2026-08-12");
    expect(shiftISO("2026-08-05", "week", -1)).toBe("2026-07-29");
    expect(shiftISO("2026-08-05", "month", 1)).toBe("2026-09-05");
  });

  it("la ventana pedida a la API es la que se está viendo", () => {
    expect(rangeForView("2026-08-15", "month")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(rangeForView("2026-08-05", "week")).toEqual({
      from: "2026-08-03",
      to: "2026-08-09",
    });
    expect(rangeForView("2026-08-05", "day")).toEqual({
      from: "2026-08-05",
      to: "2026-08-05",
    });
  });

  it("la etiqueta del rango se lee en español y cubre el rango entero", () => {
    expect(rangeLabel("2026-08-15", "month")).toBe("agosto de 2026");
    expect(rangeLabel("2026-08-05", "week")).toBe("3–9 de agosto 2026");
    expect(rangeLabel("2026-08-31", "week")).toBe(
      "31 de agosto – 6 de septiembre 2026"
    );
    expect(rangeLabel("2026-08-05", "day")).toContain("agosto");
  });
});

describe("agrupar y recortar para pintar", () => {
  it("agrupa y cuenta por día", () => {
    const items = [
      { id: "a", dayIso: "2026-08-05" },
      { id: "b", dayIso: "2026-08-05" },
      { id: "c", dayIso: "2026-08-07" },
    ];
    expect(Object.keys(groupByDay(items))).toEqual(["2026-08-05", "2026-08-07"]);
    expect(groupByDay(items)["2026-08-05"]).toHaveLength(2);
    expect(countByDay(items)).toEqual({ "2026-08-05": 2, "2026-08-07": 1 });
    expect(groupByDay([])).toEqual({});
  });

  it("las horas de la rejilla salen de lo que hay, con un suelo razonable", () => {
    expect(hoursRange([]).hours).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    // Una cita a las 7 de la mañana abre la rejilla; no se puede quedar fuera.
    const early = hoursRange([{ startMinutes: 7 * 60, endMinutes: 7 * 60 + 30 }]);
    expect(early.hours[0]).toBe(7);
    const late = hoursRange([{ startMinutes: 22 * 60, endMinutes: 23 * 60 + 30 }]);
    expect(late.hours[late.hours.length - 1]).toBe(23);
    // Ni un solo horario imposible abre la rejilla más de 24 renglones.
    const absurd = hoursRange(
      Array.from({ length: 40 }, (_, i) => ({
        startMinutes: i * 37,
        endMinutes: i * 37 + 30,
      }))
    );
    expect(absurd.hours.length).toBeLessThanOrEqual(24);
    expect(absurd.hours[0]).toBeGreaterThanOrEqual(0);
  });

  it("un bloque que cruza la medianoche se recorta, no se dibuja al revés", () => {
    expect(clipToDay({ startMinutes: 1420, endMinutes: 1480 })).toEqual({
      topMinutes: 1420,
      heightMinutes: 20,
    });
    // Lo que se solapa con este día se pinta desde la medianoche: la cola de
    // una reunión que empezó ayer sí ocupa estas primeras 40 minutos.
    expect(clipToDay({ startMinutes: -20, endMinutes: 40 })).toEqual({
      topMinutes: 0,
      heightMinutes: 40,
    });
    expect(clipToDay({ startMinutes: 1440, endMinutes: 1500 })).toBeNull();
    expect(clipToDay({ startMinutes: 600, endMinutes: 600 })).toBeNull();
  });

  it("el tono del bloque refleja el estado, y un bloqueo no es una cita", () => {
    expect(toneFor({ kind: "block", status: "agendada" })).toBe("bloqueo");
    expect(toneFor({ kind: "session", status: "agendada" })).toBe("agendada");
    expect(toneFor({ kind: "session", status: "realizada" })).toBe("realizada");
    expect(toneFor({ kind: "session", status: "cancelada" })).toBe("cancelada");
    expect(toneFor({ kind: "session", status: "no_show" })).toBe("no_show");
  });
});

describe("las horas del formulario", () => {
  it("formatea y parsea HH:MM sin sorpresas", () => {
    expect(hhmm(0)).toBe("00:00");
    expect(hhmm(1439)).toBe("23:59");
    expect(hhmm(1500)).toBe("23:59"); // fuera de día: se queda en el último minuto
    expect(minutesOfHHMM("09:30")).toBe(570);
    expect(minutesOfHHMM("24:00")).toBeNull();
    expect(minutesOfHHMM("9:7")).toBeNull();
    expect(minutesOfHHMM("")).toBeNull();
  });

  it("el fin se deriva de la duración y la duración del rango", () => {
    expect(endHHMM("09:00", 60)).toBe("10:00");
    expect(endHHMM("23:45", 60)).toBe("23:59");
    expect(endHHMM("nope", 60)).toBe("");
    expect(durationFromRange("09:00", "10:30")).toBe(90);
    expect(durationFromRange("10:30", "09:00")).toBeNull();
    expect(durationFromRange("10:00", "10:00")).toBeNull();
  });
});
