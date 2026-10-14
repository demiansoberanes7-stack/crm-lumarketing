import { describe, expect, it } from "vitest";
import {
  classifyTitlePattern,
  durationBucket,
  engagementPct,
} from "@/server/intel/content";
import { parseDurationSeconds } from "@/server/intel/sources/youtube";

describe("parseDurationSeconds (ISO 8601 de YouTube)", () => {
  it("parsea horas, minutos y segundos", () => {
    expect(parseDurationSeconds("PT1H2M3S")).toBe(3723);
    expect(parseDurationSeconds("PT4M20S")).toBe(260);
    expect(parseDurationSeconds("PT45S")).toBe(45);
    expect(parseDurationSeconds("PT2H")).toBe(7200);
  });
  it("devuelve null en formatos vacíos o inválidos", () => {
    expect(parseDurationSeconds("")).toBeNull();
    expect(parseDurationSeconds(null)).toBeNull();
    expect(parseDurationSeconds("P1D")).toBeNull();
    expect(parseDurationSeconds("PT0S")).toBeNull();
  });
});

describe("durationBucket", () => {
  it("clasifica por umbral", () => {
    expect(durationBucket(30)).toBe("short");
    expect(durationBucket(300)).toBe("medio");
    expect(durationBucket(900)).toBe("largo");
    expect(durationBucket(null)).toBe("sin_dato");
    expect(durationBucket(0)).toBe("sin_dato");
  });
});

describe("classifyTitlePattern", () => {
  it("detecta listicles antes que otras reglas", () => {
    expect(classifyTitlePattern("Top 5 cámaras baratas ¿cuál comprar?")).toBe("listicle");
    expect(classifyTitlePattern("7 trucos de seguridad que no conocías")).toBe("listicle");
  });
  it("detecta preguntas", () => {
    expect(classifyTitlePattern("¿La cámara vale la pena?")).toBe("pregunta");
    expect(classifyTitlePattern("¿Cómo instalar Starlink?")).toBe("pregunta");
  });
  it("detecta tutoriales", () => {
    expect(classifyTitlePattern("Cómo instalar una cámara Dahua")).toBe("tutorial");
    expect(classifyTitlePattern("Tutorial: red mesh desde cero")).toBe("tutorial");
  });
  it("detecta comparativas y reseñas", () => {
    expect(classifyTitlePattern("Hikvision vs Dahua 2026")).toBe("comparativa");
    expect(classifyTitlePattern("Unboxing router TP-Link")).toBe("resena");
  });
  it("cae a otro cuando no aplica ninguna regla", () => {
    expect(classifyTitlePattern("Instalación en Querétaro")).toBe("otro");
  });
});

describe("engagementPct", () => {
  it("calcula likes/vistas × 100 y null sin vistas", () => {
    expect(engagementPct(1000, 50)).toBeCloseTo(5);
    expect(engagementPct(0, 10)).toBeNull();
  });
});
