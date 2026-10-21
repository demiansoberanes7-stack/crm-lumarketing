import { describe, expect, it } from "vitest";
import { dialHref, formatPhone } from "@/lib/utils";

/**
 * Marcar el teléfono del prospecto.
 *
 * El número capturado del chat es nacional (10 dígitos, sin `52`). Con la `+`
 * puesta a la fuerza, el móvil del dueño interpretaba "código de país 462…" y
 * la llamada no salía — justo el número que Prospectos muestra para contactar.
 */

describe("dialHref", () => {
  it("a un número nacional no le inventa código de país", () => {
    expect(dialHref("4621345678")).toBe("tel:4621345678");
  });

  it("a un número con lada de país sí le pone el signo", () => {
    expect(dialHref("524621345678")).toBe("tel:+524621345678");
  });

  it("quita espacios y guiones antes de armar el enlace", () => {
    expect(dialHref("52 462 134-5678")).toBe("tel:+524621345678");
  });

});

describe("formatPhone", () => {
  it("muestra el nacional sin signo, igual que el enlace", () => {
    expect(formatPhone("4621345678")).toBe("4621345678");
    expect(formatPhone("524621345678")).toBe("+524621345678");
  });

  it("respeta la etiqueta de siempre cuando no hay número", () => {
    expect(formatPhone(null)).toBe("Sin teléfono");
  });

  it("un valor sin dígitos se muestra tal cual, sin `+` suelto", () => {
    expect(formatPhone("ext")).toBe("ext");
  });
});
