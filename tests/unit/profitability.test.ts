import { describe, expect, it } from "vitest";
import {
  projectRevenue,
  projectCost,
  projectMargin,
  campaignBudgetVariance,
  pipelineStageMargins,
} from "@/server/metrics/profitability";
import { grossMargin, grossMarginPercent } from "@/server/metrics/compute";

describe("projectRevenue", () => {
  it("suma quantity × unitPrice de todos los items", () => {
    const items = [
      { quantity: 2, unitPrice: 10000 },
      { quantity: 1, unitPrice: 50000 },
    ];
    expect(projectRevenue(items)).toBe(70000);
  });

  it("retorna 0 para lista vacía", () => {
    expect(projectRevenue([])).toBe(0);
  });
});

describe("projectCost", () => {
  it("suma costCents × quantity por productId", () => {
    const items = [
      { quantity: 2, unitPrice: 10000, productId: "prod_1" },
      { quantity: 1, unitPrice: 50000, productId: "prod_2" },
    ];
    const costs = new Map([
      ["prod_1", 5000],
      ["prod_2", 30000],
    ]);
    expect(projectCost(items, costs)).toBe(40000);
  });

  it("items sin productId usan costo 0", () => {
    const items = [{ quantity: 1, unitPrice: 10000, productId: null }];
    const costs = new Map<string, number>();
    expect(projectCost(items, costs)).toBe(0);
  });
});

describe("projectMargin", () => {
  it("calcula margen e ingreso correctamente", () => {
    const items = [{ quantity: 1, unitPrice: 100000, productId: "prod_1" }];
    const costs = new Map([["prod_1", 40000]]);
    const result = projectMargin(items, costs);
    expect(result.revenue).toBe(100000);
    expect(result.cost).toBe(40000);
    expect(result.margin).toBe(60000);
    expect(result.marginPercent).toBe(60);
  });

  it("margen negativo si costo > ingreso (pérdida visible, no null)", () => {
    const items = [{ quantity: 1, unitPrice: 10000, productId: "prod_1" }];
    const costs = new Map([["prod_1", 20000]]);
    const result = projectMargin(items, costs);
    expect(result.margin).toBe(-10000);
    expect(result.marginPercent).toBe(-100);
  });

  it("margin null solo cuando no hay nada que medir", () => {
    const result = projectMargin([], new Map<string, number>());
    expect(result.margin).toBeNull();
  });

  it("marginPercent null si ingreso es 0", () => {
    const items = [{ quantity: 0, unitPrice: 0, productId: "prod_1" }];
    const costs = new Map([["prod_1", 1000]]);
    const result = projectMargin(items, costs);
    expect(result.marginPercent).toBeNull();
  });
});

describe("campaignBudgetVariance", () => {
  it("calcula diferencia y porcentaje", () => {
    const result = campaignBudgetVariance(100000, 80000);
    expect(result.diffCents).toBe(20000);
    expect(result.percent).toBe(20);
  });

  it("porcentaje null si presupuesto planeado es 0", () => {
    const result = campaignBudgetVariance(0, 50000);
    expect(result.diffCents).toBe(-50000);
    expect(result.percent).toBeNull();
  });

  it("diferencia negativa si se gastó de más", () => {
    const result = campaignBudgetVariance(100000, 120000);
    expect(result.diffCents).toBe(-20000);
    expect(result.percent).toBe(-20);
  });
});

describe("pipelineStageMargins", () => {
  it("promedia solo márgenes válidos", () => {
    const result = pipelineStageMargins([100, null, 200, 300], "stage_1");
    expect(result.avgMargin).toBe(200);
    expect(result.count).toBe(3);
    expect(result.stageId).toBe("stage_1");
  });

  it("avgMargin null si no hay márgenes válidos", () => {
    const result = pipelineStageMargins([null, null], "stage_1");
    expect(result.avgMargin).toBeNull();
    expect(result.count).toBe(0);
  });
});

describe("grossMargin (compute)", () => {
  it("ingreso - costo", () => {
    expect(grossMargin(100000, 40000)).toBe(60000);
  });
});

describe("grossMarginPercent (compute)", () => {
  it("porcentaje de margen bruto", () => {
    expect(grossMarginPercent(100000, 40000)).toBe(60);
  });

  it("null si ingreso es 0", () => {
    expect(grossMarginPercent(0, 10000)).toBeNull();
  });
});
