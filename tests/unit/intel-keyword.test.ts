import { describe, expect, it } from "vitest";
import { classifyIntent, difficultyProxy } from "@/server/intel/keyword";

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
  it("cae a navegacional por defecto", () => {
    expect(classifyIntent("cámaras de seguridad")).toBe("navegacional");
  });
});

describe("difficultyProxy (solo DENUE)", () => {
  it("es baja con poca oferta local", () => {
    const d = difficultyProxy({ establishments: 2, censored: false });
    expect(d.score).toBeLessThan(25);
    expect(d.band).toBe("baja");
    expect(d.factors).toHaveLength(1);
  });
  it("es muy alta con mucha oferta (censurada)", () => {
    const d = difficultyProxy({ establishments: 200, censored: true });
    expect(d.score).toBeGreaterThan(75);
    expect(d.band).toBe("muy alta");
  });
  it("sin DENUE devuelve score 0 y lo dice en la fórmula", () => {
    const d = difficultyProxy({ establishments: null, censored: false });
    expect(d.score).toBe(0);
    expect(d.factors).toHaveLength(0);
    expect(d.formula).toContain("Sin DENUE");
  });
  it("con DENUE el único factor pesa 100%", () => {
    const d = difficultyProxy({ establishments: 30, censored: false });
    expect(d.factors).toHaveLength(1);
    expect(d.factors[0]!.weightPct).toBe(100);
  });
});
