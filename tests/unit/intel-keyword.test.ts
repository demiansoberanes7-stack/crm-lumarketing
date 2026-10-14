import { describe, expect, it } from "vitest";
import {
  classifyIntent,
  difficultyProxy,
  isQuestion,
} from "@/server/intel/keyword";

describe("classifyIntent (intención de búsqueda)", () => {
  it("detecta intención transaccional con prioridad máxima", () => {
    expect(classifyIntent("comprar cámara de seguridad")).toBe("transaccional");
    expect(classifyIntent("precio de starlink méxico")).toBe("transaccional");
    expect(classifyIntent("mejores taladros en oferta")).toBe("transaccional");
    expect(classifyIntent("cuanto cuesta una laptop gamer")).toBe("transaccional");
  });
  it("detecta intención comercial", () => {
    expect(classifyIntent("mejores cámaras de seguridad 2026")).toBe("comercial");
    expect(classifyIntent("hikvision vs dahua")).toBe("comercial");
    expect(classifyIntent("review tp-link axe75")).toBe("comercial");
  });
  it("detecta intención informativa", () => {
    expect(classifyIntent("cómo instalar una cámara ip")).toBe("informativo");
    expect(classifyIntent("qué es un nvr")).toBe("informativo");
    expect(classifyIntent("errores de red wifi")).toBe("informativo");
  });
  it("cae a informativo por defecto", () => {
    expect(classifyIntent("cámaras de seguridad")).toBe("informativo");
  });
});

describe("isQuestion", () => {
  it("detecta signos y palabras interrogativas", () => {
    expect(isQuestion("¿La cámara vale la pena?")).toBe(true);
    expect(isQuestion("mejor router")).toBe(false);
    expect(isQuestion("cómo instalar starlink")).toBe(true);
    expect(isQuestion("cuanto cuesta un pc gamer")).toBe(true);
  });
});

describe("difficultyProxy (fórmula documentada)", () => {
  it("es baja con poca saturación, incumbentes débiles y poca oferta", () => {
    const d = difficultyProxy({
      totalResults: 200,
      medianViews: 2000,
      establishments: 2,
      censored: false,
    });
    expect(d.score).toBeLessThan(25);
    expect(d.band).toBe("baja");
  });
  it("es muy alta con SERP saturado e incumbentes fuertes", () => {
    const d = difficultyProxy({
      totalResults: 900_000,
      medianViews: 4_000_000,
      establishments: 200,
      censored: true,
    });
    expect(d.score).toBeGreaterThan(75);
    expect(d.band).toBe("muy alta");
  });
  it("sin DENUE redistribuye los pesos y lo dice en la fórmula", () => {
    const d = difficultyProxy({
      totalResults: 50_000,
      medianViews: 100_000,
      establishments: null,
      censored: false,
    });
    expect(d.factors).toHaveLength(2);
    expect(d.factors.every((f) => f.weightPct === 50)).toBe(true);
    expect(d.formula).toContain("50%");
  });
  it("los factores suman 100 de peso", () => {
    const d = difficultyProxy({
      totalResults: 10_000,
      medianViews: 50_000,
      establishments: 30,
      censored: false,
    });
    const totalWeight = d.factors.reduce((a, f) => a + f.weightPct, 0);
    expect(totalWeight).toBe(100);
  });
});
