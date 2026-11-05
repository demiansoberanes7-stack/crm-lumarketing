import { describe, expect, it } from "vitest";
import {
  COST_LINES_MAX,
  computeProductCost,
  lineCostCents,
  marginOf,
  type CostLineDraft,
} from "@/lib/catalog/cost";

/**
 * La matemática de la receta de costos.
 *
 * Es la parte que se puede probar sin base de datos y la que más le importa al
 * negocio: cuánto cuesta producir y cuánto queda. Se fija:
 *
 *  1. El centavo sale redondo y entero. Con dinero, `0.1 + 0.2` no es un detalle.
 *  2. El `% de mezcla` es `null` cuando las unidades no son comparables. Un 60 %
 *     inventado de "300 g y 2 piezas" es peor que un vacío.
 *  3. Un denominador 0 (precio o costo sin registrar) da `null`, no `Infinity`,
 *     `NaN` ni «0 %» — «0 %» afirmaría que no queda margen cuando no se sabe.
 *  4. El margen que ve la rejilla y el que ve la receta salen de la misma
 *     función; si se separan, la tarjeta miente.
 *  5. Nunca lanza, aunque le llegue basura: también la llama el navegador
 *     mientras el usuario escribe a medias.
 */

const line = (
  name: string,
  quantity: number,
  unit: string,
  unitPriceCents: number
): CostLineDraft => ({ name, quantity, unit, unitPriceCents });

describe("línea individual", () => {
  it("0,3 kg a $800/kg son $240.00, ni un centavo de más", () => {
    expect(lineCostCents(0.3, 80_000)).toBe(24_000);
  });

  it("redondea al centavo, no deja fracciones", () => {
    // 0.333 × 100 centavos = 33.3 → 33
    expect(lineCostCents(0.333, 100)).toBe(33);
    // 1.5 × 399 = 598.5 → 599 (empates arriba, como la factura)
    expect(lineCostCents(1.5, 399)).toBe(599);
  });

  it("basura entra, cero sale: no NaN en la pantalla", () => {
    expect(lineCostCents(Number.NaN, 100)).toBe(0);
    expect(lineCostCents(2, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("receta completa", () => {
  it("costo total, mezcla y aporte al costo", () => {
    const view = computeProductCost(50_000, [
      line("Cera de soya", 0.3, "kg", 80_000), // $240.00 → 24 000
      line("Esencia", 0.02, "kg", 50_000), //     $10.00  →  1 000
    ]);

    expect(view.totals.totalCostCents).toBe(25_000);
    expect(view.lines[0]!.costCents).toBe(24_000);
    expect(view.totals.totalQuantity).toBeCloseTo(0.32, 10);
    // mezclas: 0.3/0.32 = 93.75 % → un decimal
    expect(view.lines[0]!.mixPct).toBe(93.8);
    expect(view.lines[1]!.mixPct).toBe(6.3);
    expect(view.lines[1]!.costPct).toBe(4);
    // margen 500 − 250 = 250 sobre 500 = 50 %
    expect(view.totals.marginCents).toBe(25_000);
    expect(view.totals.marginPct).toBe(50);
  });

  it("unidades distintas: el % de mezcla se queda en null, no se inventa", () => {
    const view = computeProductCost(50_000, [
      line("Cera", 0.3, "kg", 80_000),
      line("Mecha", 2, "pza", 1_500),
      line("Frasco", 1, "pza", 4_000),
    ]);
    expect(view.totals.mixComparable).toBe(false);
    expect(view.lines.every((l) => l.mixPct === null)).toBe(true);
    // El % del costo sí tiene sentido: todas las líneas están en dinero.
    // 24 000 de 31 000 = 77,4 %
    expect(view.lines[0]!.costPct).toBe(77.4);
    expect(view.totals.units).toEqual(["kg", "pza"]);
  });

  it("kg y KG son la misma medida; kg y g no", () => {
    const misma = computeProductCost(0, [
      line("A", 1, "kg", 100),
      line("B", 3, "KG", 100),
    ]);
    expect(misma.totals.mixComparable).toBe(true);
    expect(misma.lines[1]!.mixPct).toBe(75);

    const distinta = computeProductCost(0, [
      line("A", 1, "kg", 100),
      line("B", 300, "g", 100),
    ]);
    expect(distinta.totals.mixComparable).toBe(false);
  });

  it("una sola línea no es una mezcla", () => {
    const view = computeProductCost(10_000, [line("Cera", 0.3, "kg", 80_000)]);
    expect(view.totals.mixComparable).toBe(false);
    expect(view.lines[0]!.mixPct).toBe(null);
    expect(view.lines[0]!.costPct).toBe(100);
  });

  it("sin precio no hay margen en %: null, no 0 % ni Infinity", () => {
    const view = computeProductCost(0, [line("Cera", 1, "kg", 80_000)]);
    expect(view.totals.marginCents).toBe(-80_000);
    expect(view.totals.marginPct).toBe(null);
    expect(view.totals.priceCents).toBe(0);
  });

  it("receta vacía: costo 0 y ceros en todos los porcentajes", () => {
    const view = computeProductCost(10_000, []);
    expect(view.totals).toMatchObject({
      lineCount: 0,
      totalCostCents: 0,
      marginCents: 10_000,
      marginPct: 100,
      mixComparable: false,
      totalQuantity: 0,
    });
    expect(view.lines).toEqual([]);
  });

  it("costo 0 por ahora: costPct null, no 0 %", () => {
    const view = computeProductCost(10_000, [line("Regalo", 1, "pza", 0)]);
    expect(view.totals.totalCostCents).toBe(0);
    expect(view.lines[0]!.costPct).toBe(null);
  });

  it("cuesta más de lo que vale: margen negativo y visible", () => {
    const view = computeProductCost(5_000, [line("Importado", 1, "pza", 7_000)]);
    expect(view.totals.marginCents).toBe(-2_000);
    expect(view.totals.marginPct).toBe(-40);
  });

  it("no lanza con entradas imposibles", () => {
    expect(() =>
      computeProductCost(Number.NaN, [
        line("", Number.NaN, "  ", Number.POSITIVE_INFINITY),
        line("ok", -5, "kg", -100),
      ])
    ).not.toThrow();
    const view = computeProductCost(Number.NaN, [
      line("", Number.NaN, "  ", Number.POSITIVE_INFINITY),
      line("ok", -5, "kg", -100),
    ]);
    expect(view.totals.totalCostCents).toBe(0);
    expect(view.totals.priceCents).toBe(0);
    expect(view.totals.totalQuantity).toBe(0);
  });

  it("el número grande sigue siendo entero: techo de 60 insumos carísimos", () => {
    const many = Array.from({ length: COST_LINES_MAX }, (_, i) =>
      line(`i${i}`, 1_000_000, "g", 100_000_000)
    );
    const view = computeProductCost(0, many);
    // 60 × 1e6 × 1e8 = 6e15: debajo de Number.MAX_SAFE_INTEGER (9.007e15).
    // Si alguien sube los techos de 0090 sin mirar esto, la suma deja de ser
    // exacta y el costo empieza a mentir en los últimos centavos.
    expect(Number.isSafeInteger(view.totals.totalCostCents)).toBe(true);
    expect(view.totals.totalCostCents).toBe(6_000_000_000_000_000);
  });
});

describe("marginOf (la rejilla y la receta dicen lo mismo)", () => {
  it("coincide con los totales de computeProductCost, linea a linea", () => {
    const cases: [number, CostLineDraft[]][] = [
      [50_000, [line("Cera", 0.3, "kg", 80_000), line("Mecha", 2, "pza", 1_500)]],
      [0, [line("Cera", 1, "kg", 80_000)]],
      [10_000, []],
      [5_000, [line("Importado", 1, "pza", 7_000)]],
      [Number.NaN, [line("Raro", Number.NaN, "pza", 1)]],
    ];
    for (const [price, lines] of cases) {
      const totals = computeProductCost(price, lines).totals;
      expect(marginOf(price, totals.totalCostCents)).toMatchObject({
        marginCents: totals.marginCents,
        marginPct: totals.marginPct,
      });
    }
  });

  it("sin precio: margen en dinero pero porcentaje null", () => {
    expect(marginOf(0, 5_000)).toEqual({
      priceCents: 0,
      marginCents: -5_000,
      marginPct: null,
    });
  });
});
