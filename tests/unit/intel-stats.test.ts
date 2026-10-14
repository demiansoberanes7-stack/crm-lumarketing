import { describe, expect, it } from "vitest";
import {
  classify,
  describe as describeSeries,
  growthZ,
  mean,
  median,
  normalCdf,
  normalizeText,
  oneSidedP,
  quantile,
  sampleStdDev,
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
