import { describe, it, expect } from "vitest";
import {
  safeDivide,
  safePercent,
  roas,
  romi,
  cac,
  contribution,
  contributionMargin,
  conversionRate,
  winRate,
  averageTicket,
  percentChange,
  sumByCurrency,
  attributionWeightedSpend,
  averageOf,
  experimentLift,
  evidenceStatus,
  formatCurrency,
  formatPercent,
  formatRatio,
} from "@/server/metrics/compute";
import { METRIC_CATALOG, getMetric, metricsByCategory } from "@/server/metrics/catalog";

describe("metrics: división segura (no disponible ≠ 0)", () => {
  it("devuelve null cuando el denominador es 0 o negativo, no Infinity ni NaN", () => {
    expect(safeDivide(10, 0)).toBeNull();
    expect(safeDivide(10, -1)).toBeNull();
    expect(safeDivide(0, 0)).toBeNull();
    expect(safeDivide(10, null)).toBeNull();
    expect(safeDivide(null, 5)).toBeNull();
    expect(safeDivide(Number.NaN, 5)).toBeNull();
  });
  it("devuelve la razón cuando el denominador es positivo", () => {
    expect(safeDivide(10, 4)).toBe(2.5);
    expect(safePercent(1, 4)).toBe(25);
  });
});

describe("metrics: ROAS y ROMI", () => {
  it("ROAS = ingresos ÷ inversión", () => {
    expect(roas(500000, 100000)).toBe(5);
    expect(roas(0, 100000)).toBe(0);
  });
  it("sin inversión (>0) el ROAS no existe: null, no Infinity", () => {
    expect(roas(500000, 0)).toBeNull();
    expect(roas(500000, null)).toBeNull();
  });
  it("ROMI = (ingresos − inversión) ÷ inversión × 100; negativo si no se paga", () => {
    expect(romi(500000, 100000)).toBe(400);
    expect(romi(80000, 100000)).toBe(-20);
    expect(romi(500000, 0)).toBeNull();
  });
});

describe("metrics: CAC", () => {
  it("CAC = costo ÷ clientes nuevos", () => {
    expect(cac(300000, 10)).toBe(30000);
  });
  it("sin clientes el CAC no se inventa: null", () => {
    expect(cac(300000, 0)).toBeNull();
    expect(cac(300000, null)).toBeNull();
  });
});

describe("metrics: contribución y margen", () => {
  it("contribución = ingresos − costo de prestación − inversión", () => {
    expect(contribution(1000000, 400000, 200000)).toBe(400000);
    // inversión desconocida se deja fuera
    expect(contribution(1000000, 400000)).toBe(600000);
    expect(contribution(1000000, 400000, null)).toBe(600000);
  });
  it("margen de contribución = contribución ÷ ingresos × 100 (null si ingresos ≤ 0)", () => {
    expect(contributionMargin(400000, 1000000)).toBe(40);
    expect(contributionMargin(400000, 0)).toBeNull();
    expect(contributionMargin(-100, 1000)).toBe(-10);
  });
});

describe("metrics: embudo y cierre", () => {
  it("tasa de conversión = convertidos ÷ oportunidades × 100", () => {
    expect(conversionRate(5, 20)).toBe(25);
    expect(conversionRate(5, 0)).toBeNull();
  });
  it("tasa de cierre = ganados ÷ (ganados + perdidos) × 100", () => {
    expect(winRate(3, 7)).toBe(30);
    expect(winRate(0, 0)).toBeNull();
    expect(winRate(5, 0)).toBe(100);
  });
  it("ticket promedio = ingresos ÷ cobros (null sin cobros)", () => {
    expect(averageTicket(100000, 4)).toBe(25000);
    expect(averageTicket(100000, 0)).toBeNull();
  });
});

describe("metrics: variación entre periodos", () => {
  it("variación porcentual con base 0 es null (no 'creció ∞%')", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });
});

describe("metrics: monedas no se mezclan", () => {
  it("agrupa por moneda y marca `mixed` si hay más de una", () => {
    const { totals, mixed } = sumByCurrency([
      { amount: 100, currency: "MXN" },
      { amount: 50, currency: "mxn" },
      { amount: 20, currency: "USD" },
    ]);
    expect(totals.MXN).toBe(150);
    expect(totals.USD).toBe(20);
    expect(mixed).toBe(true);
  });
  it("una sola moneda no está mezclada y asume MXN por defecto", () => {
    const { totals, mixed } = sumByCurrency([{ amount: 10 }, { amount: 5, currency: null }]);
    expect(totals.MXN).toBe(15);
    expect(mixed).toBe(false);
  });
});

describe("metrics: agregados auxiliares", () => {
  it("inversión ponderada = Σ(spend × weight)", () => {
    expect(attributionWeightedSpend([{ spend: 100, weight: 0.5 }, { spend: 200, weight: 1 }])).toBe(250);
    expect(attributionWeightedSpend([])).toBe(0);
  });
  it("promedio ignora null/undefined y devuelve null si no hay números", () => {
    expect(averageOf([2, null, 4, undefined, 6])).toBe(4);
    expect(averageOf([null, undefined])).toBeNull();
    expect(averageOf([])).toBeNull();
  });
});

describe("metrics: experimentos", () => {
  it("lift = (variante − control) ÷ control × 100", () => {
    expect(experimentLift(0.12, 0.10)).toBeCloseTo(20);
    expect(experimentLift(0.08, 0.10)).toBeCloseTo(-20);
    expect(experimentLift(0.12, 0)).toBeNull();
  });
  it("evidencia concluyente solo cuando los intervalos NO se solapan", () => {
    expect(evidenceStatus([0.15, 0.25], [0.05, 0.12])).toBe("concluyente");
    expect(evidenceStatus([0.11, 0.20], [0.08, 0.14])).toBe("inconcluso");
    expect(evidenceStatus(null, [0.05, 0.12])).toBe("inconcluso");
    expect(evidenceStatus([0.15, 0.25], null)).toBe("inconcluso");
  });
});

describe("metrics: formateadores", () => {
  it("formatea moneda MXN desde centavos, porcentaje y razón", () => {
    expect(formatCurrency(123450)).toContain("1,234.50");
    expect(formatPercent(42.35)).toBe("42.4%");
    expect(formatRatio(4.567)).toBe("4.57x");
  });
});

describe("metrics: catálogo", () => {
  it("cada métrica del catálogo es única y tiene fórmula y fuentes", () => {
    const ids = METRIC_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of METRIC_CATALOG) {
      expect(m.formula.length).toBeGreaterThan(0);
      expect(m.requires.length).toBeGreaterThan(0);
    }
  });
  it("getMetric y metricsByCategory filtran correctamente", () => {
    expect(getMetric("roas")?.unit).toBe("ratio");
    expect(getMetric("no_existe")).toBeUndefined();
    const publicidad = metricsByCategory("publicidad");
    expect(publicidad.every((m) => m.category === "publicidad")).toBe(true);
    expect(publicidad.length).toBeGreaterThanOrEqual(3);
  });
});
