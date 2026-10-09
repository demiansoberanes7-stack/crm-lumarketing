import { describe, expect, it } from "vitest";
import {
  MEDIUM_LABELS,
  MEDIUM_VALUES,
  mediumLabel,
  normalizeMedium,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
} from "@/lib/contact-medium";

/* Medio por el que se contactó: el desplegable de la ficha. */

describe("catálogo del medio de contacto", () => {
  it("cubre lo que el dueño pidió: red social, llamada, correo y presencial", () => {
    for (const value of ["red_social", "llamada", "correo", "presencial"]) {
      expect(MEDIUM_VALUES).toContain(value);
      expect(MEDIUM_LABELS[value as keyof typeof MEDIUM_LABELS]).toBeTruthy();
    }
  });

  it("toda opción tiene etiqueta, y las redes también", () => {
    for (const value of MEDIUM_VALUES) expect(MEDIUM_LABELS[value]).toBeTruthy();
    for (const network of SOCIAL_NETWORKS) expect(SOCIAL_LABELS[network]).toBeTruthy();
  });
});

describe("etiqueta que se pinta en la ficha", () => {
  it("la red social se acompaña de la red elegida", () => {
    expect(mediumLabel("red_social", "instagram")).toBe("Red social · Instagram");
    expect(mediumLabel("red_social", "otra")).toBe("Red social · Otra red");
  });

  it("sin red elegida no se adivina ninguna", () => {
    expect(mediumLabel("red_social", null)).toBe("Red social");
    expect(mediumLabel("red_social", "myspace")).toBe("Red social");
  });

  it("los demás medios se etiquetan solos", () => {
    expect(mediumLabel("llamada")).toBe("Llamada");
    expect(mediumLabel("correo")).toBe("Correo");
    expect(mediumLabel("presencial")).toBe("Presencial");
  });

  it("nada capturado (o basura vieja) no inventa etiqueta", () => {
    expect(mediumLabel(null)).toBeNull();
    expect(mediumLabel(undefined)).toBeNull();
    expect(mediumLabel("")).toBeNull();
    expect(mediumLabel("reunion")).toBeNull();
  });
});

describe("normalización antes de guardar", () => {
  it("vacío es sin capturar, no 'otro'", () => {
    expect(normalizeMedium({})).toEqual({ ok: true, medium: null, mediumDetail: null });
    expect(normalizeMedium({ medium: "", mediumDetail: "instagram" })).toEqual({
      ok: true,
      medium: null,
      mediumDetail: null,
    });
  });

  it("un medio que no es red social tira el detalle viejo", () => {
    expect(normalizeMedium({ medium: "llamada", mediumDetail: "facebook" })).toEqual({
      ok: true,
      medium: "llamada",
      mediumDetail: null,
    });
    expect(normalizeMedium({ medium: "correo" })).toEqual({
      ok: true,
      medium: "correo",
      mediumDetail: null,
    });
  });

  it("red social exige la red: a medias no se guarda", () => {
    expect(normalizeMedium({ medium: "red_social" })).toEqual({
      ok: false,
      error: "Elige con qué red social se contactó.",
    });
    expect(normalizeMedium({ medium: "red_social", mediumDetail: "" })).toEqual({
      ok: false,
      error: "Elige con qué red social se contactó.",
    });
    expect(normalizeMedium({ medium: "red_social", mediumDetail: "tiktok" })).toEqual({
      ok: true,
      medium: "red_social",
      mediumDetail: "tiktok",
    });
  });

  it("medios inventados por la API se rechazan en vez de guardarlos", () => {
    expect(normalizeMedium({ medium: "telepatia" })).toEqual({
      ok: false,
      error: "El medio no es uno de los reconocidos.",
    });
    expect(normalizeMedium({ medium: "red_social", mediumDetail: "myspace" })).toEqual({
      ok: false,
      error: "Elige con qué red social se contactó.",
    });
  });
});
