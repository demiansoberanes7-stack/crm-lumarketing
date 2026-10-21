import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("estas pruebas solo revisan el periodo, no consultan la base");
  },
  schema: {},
}));

const { zonedDateInput, zonedMonthBounds } = await import("@/lib/dates");
const { reportPeriod } = await import("@/server/finances/report");

/**
 * El contenedor corre en UTC y el negocio en la Ciudad de México (UTC-6). Con
 * las fechas del sistema en UTC, desde las 18:00 locales del último día del mes
 * el reporte de Balance abría en el mes siguiente: «sin ingresos este mes»
 * cuando el mes seguía en curso. Mismo corte aplicaba a «hoy» para las cuentas
 * vencidas.
 */
describe("periodos en la zona del negocio", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("el día negocio es el anterior cuando UTC ya saltó de día", () => {
    // 01:00 UTC del 1 de noviembre = 19:00 del 31 de octubre en la CDMX.
    const now = new Date("2026-11-01T01:00:00Z");
    expect(now.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(zonedDateInput(now)).toBe("2026-10-31");
  });

  it("el mes en curso sigue siendo octubre a las 19:00 del día 31", () => {
    const bounds = zonedMonthBounds(new Date("2026-11-01T01:00:00Z"));
    expect(bounds).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("corta el mes en su último día real, febrero bisiesto incluido", () => {
    expect(zonedMonthBounds(new Date("2028-02-10T18:00:00Z"))).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(zonedMonthBounds(new Date("2026-02-10T18:00:00Z")).to).toBe("2026-02-28");
  });

  it("sin from/to en la consulta, el reporte usa el mes del negocio", () => {
    vi.setSystemTime(new Date("2026-11-01T01:30:00Z"));
    const period = reportPeriod(new URLSearchParams(""));
    expect(period.from.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(period.to.toISOString().slice(0, 10)).toBe("2026-10-31");
  });

  it("respeta el rango explícito del dueño, solo normalizado a UTC", () => {
    const period = reportPeriod(new URLSearchParams("from=2026-09-05&to=2026-09-19"));
    expect(period.from.toISOString()).toBe("2026-09-05T00:00:00.000Z");
    expect(period.to.toISOString()).toBe("2026-09-19T23:59:59.999Z");
  });

  it("rechaza fechas inventadas en vez de devolver un periodo roto", () => {
    expect(() => reportPeriod(new URLSearchParams("from=2026-02-31&to=2026-03-05"))).toThrow(
      "Fecha no válida"
    );
    expect(() => reportPeriod(new URLSearchParams("from=2026-10-05&to=2026-10-01"))).toThrow(
      "La fecha inicial debe ser anterior a la final"
    );
    expect(() => reportPeriod(new URLSearchParams("from=2026-10-05"))).toThrow(
      "Indica ambas fechas"
    );
  });
});
