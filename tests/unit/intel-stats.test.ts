import { describe, expect, it } from "vitest";
import {
  classify,
  describe as describeSeries,
  detectBreakout,
  growthZ,
  mean,
  median,
  normalCdf,
  normalizeText,
  oneSidedP,
  pctChange,
  quantile,
  rankWithTiers,
  regionIndex,
  sampleStdDev,
  smoothMA,
  toIndex,
} from "@/server/intel/stats";

describe("stats básicas", () => {
  it("median de muestra impar/par", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("quantile interpola linealmente", () => {
    expect(quantile([0, 10], 0.25)).toBe(2.5);
    expect(quantile([0, 10], 0.75)).toBe(7.5);
  });

  it("std muestral (n-1) y media", () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    expect(sampleStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
    expect(sampleStdDev([1])).toBe(0);
  });

  it("describe entrega el set completo", () => {
    const d = describeSeries([10, 20, 30, 40, 50]);
    expect(d.n).toBe(5);
    expect(d.median).toBe(30);
    expect(d.min).toBe(10);
    expect(d.max).toBe(50);
  });
});

describe("normal CDF y p", () => {
  it("CDF simétrica", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 2);
  });

  it("p unilateral coherente con la CDF", () => {
    expect(oneSidedP(0)).toBeCloseTo(0.5, 5);
    expect(oneSidedP(1.645)).toBeCloseTo(0.05, 2);
  });
});

describe("growthZ", () => {
  it("detecta alza clara contra histórico estable", () => {
    const prior = [10, 11, 9, 10, 12, 10, 11, 9, 10, 11, 10, 9, 11, 10];
    const z = growthZ([40, 45, 50], prior);
    expect(z).not.toBeNull();
    expect(z!).toBeGreaterThan(1.5);
  });

  it("null con histórico corto o plano", () => {
    expect(growthZ([10, 10], [1, 2, 3])).toBeNull();
    expect(growthZ([5, 5], [5, 5, 5, 5, 5, 5, 5])).toBeNull();
  });
});

describe("classify (A/B/C/D)", () => {
  it("D con menos de 7 días", () => {
    const r = classify({ daysWithData: 3, z: 2 });
    expect(r.classification).toBe("D");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("D sin base de z", () => {
    expect(classify({ daysWithData: 28, z: null }).classification).toBe("D");
  });

  it("A con z ≥ 1.5", () => {
    expect(classify({ daysWithData: 28, z: 1.8 }).classification).toBe("A");
  });

  it("B con z en [0, 1.5)", () => {
    expect(classify({ daysWithData: 28, z: 0.4 }).classification).toBe("B");
  });

  it("C con z < 0", () => {
    expect(classify({ daysWithData: 28, z: -0.7 }).classification).toBe("C");
  });
});

describe("normalizeText", () => {
  it("quita acentos y pasa a minúsculas", () => {
    expect(normalizeText("Cámaras de Seguridad IP")).toBe("camaras de seguridad ip");
    expect(normalizeText("¡PC Gamer, #1!")).toBe("pc gamer 1");
  });
});

describe("toIndex (0-100)", () => {
  it("normaliza el máximo a 100", () => {
    expect(toIndex([10, 20, 50, 40])).toEqual([20, 40, 100, 80]);
  });

  it("serie plana en 0 → todos 0", () => {
    expect(toIndex([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("serie vacía → []", () => {
    expect(toIndex([])).toEqual([]);
  });

  it("un solo punto → [100]", () => {
    expect(toIndex([42])).toEqual([100]);
  });
});

describe("smoothMA", () => {
  it("suaviza con ventana 3", () => {
    // [1, 2, 3, 4, 5] → bordes usan ventana disponible
    const out = smoothMA([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeCloseTo(1.5, 5); // mean([1,2])
    expect(out[2]).toBeCloseTo(3, 5); // mean([2,3,4])
    expect(out[4]).toBeCloseTo(4.5, 5); // mean([4,5])
  });

  it("window <= 1 o serie vacía → serie original", () => {
    expect(smoothMA([1, 2, 3], 1)).toEqual([1, 2, 3]);
    expect(smoothMA([], 7)).toEqual([]);
  });
});

describe("pctChange", () => {
  it("crecimiento y contracción", () => {
    expect(pctChange([20, 20], [10, 10])).toBeCloseTo(100, 5);
    expect(pctChange([5, 5], [10, 10])).toBeCloseTo(-50, 5);
  });

  it("previo ~ 0 → null (no dividir por cero)", () => {
    expect(pctChange([5, 5], [0, 0])).toBeNull();
    expect(pctChange([5, 5], [])).toBeNull();
  });
});

describe("detectBreakout", () => {
  it("baseline ~0 y ahora señal → breakout, sin %", () => {
    const r = detectBreakout([80, 90, 100], [0, 1, 0, 2]);
    expect(r.isBreakout).toBe(true);
    expect(r.pct).toBeNull();
    expect(r.label).toBe("Aumento puntual");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("crecimiento normal → % con signo", () => {
    const r = detectBreakout([40, 45, 50], [20, 22, 18, 21]);
    expect(r.isBreakout).toBe(false);
    expect(r.pct).not.toBeNull();
    expect(r.label).toMatch(/^\+/);
  });

  it("contracción → % negativo", () => {
    const r = detectBreakout([10, 12], [40, 42, 38, 41]);
    expect(r.isBreakout).toBe(false);
    expect(r.label).toMatch(/^-/);
  });

  it("sin datos → s/d", () => {
    const r = detectBreakout([], []);
    expect(r.isBreakout).toBe(false);
    expect(r.label).toBe("s/d");
  });
});

describe("rankWithTiers", () => {
  it("ordena descendente y asigna ranks", () => {
    const out = rankWithTiers([
      { item: "a", value: 50 },
      { item: "b", value: 100 },
      { item: "c", value: 30 },
    ]);
    expect(out.map((r) => r.item)).toEqual(["b", "a", "c"]);
    expect(out.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("empata valores casi iguales (mismo tier)", () => {
    const out = rankWithTiers([
      { item: "x", value: 100 },
      { item: "y", value: 99.5 },
      { item: "z", value: 80 },
    ]);
    // x e y empatan (< 1.0 de tolerancia)
    expect(out[0]!.tier).toBe(out[1]!.tier);
    expect(out[1]!.tiedWithPrevious).toBe(true);
    expect(out[2]!.tiedWithPrevious).toBe(false);
  });

  it("valores 0 quedan al final con tier alto", () => {
    const out = rankWithTiers([
      { item: "zero", value: 0 },
      { item: "one", value: 50 },
    ]);
    expect(out[0]!.item).toBe("one");
    expect(out[1]!.tier).toBeGreaterThan(1000);
  });
});

describe("regionIndex", () => {
  it("el máximo recibe 100", () => {
    const out = regionIndex([
      { key: "CHH", value: 200 },
      { key: "TAX", value: 196 },
      { key: "HID", value: 100 },
    ]);
    expect(out[0]!.index).toBe(100);
    expect(out[1]!.index).toBe(98);
    expect(out[2]!.index).toBe(50);
  });

  it("máximo 0 → todos 0", () => {
    const out = regionIndex([
      { key: "a", value: 0 },
      { key: "b", value: 0 },
    ]);
    expect(out.every((r) => r.index === 0)).toBe(true);
  });
});
