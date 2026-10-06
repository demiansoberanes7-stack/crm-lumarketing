import { describe, expect, it } from "vitest";
import { describeSendError, describeSendErrorText } from "@/lib/meta/send-errors";

describe("describeSendError (fallo real del 2026-08-05)", () => {
  it("130472 → explica el experimento de Meta y qué hacer", () => {
    const msg = describeSendError(130472, "User's number is part of an experiment");
    expect(msg).toMatch(/experimento/i);
    expect(msg).toMatch(/130472/);
    // Nada de jerga cruda de Meta en la frase principal.
    expect(msg).not.toMatch(/User's number/);
  });

  it("códigos conocidos de ventana y destinatario", () => {
    expect(describeSendError(131047)).toMatch(/24 h/);
    expect(describeSendError(131047)).toMatch(/no permite reabrir/i);
    expect(describeSendError(131026)).toMatch(/no puede recibir/i);
  });

  it("código desconocido → conserva el texto crudo de Meta y el número", () => {
    expect(describeSendError(999999, "Something odd happened")).toBe(
      "Something odd happened (Meta 999999)"
    );
  });

  it("sin código ni texto → mensaje honesto, nunca vacío", () => {
    expect(describeSendError(null)).toBe("Meta rechazó el envío");
    expect(describeSendError(undefined, "   ")).toBe("Meta rechazó el envío");
  });

  it("sin código pero con texto → usa el texto tal cual", () => {
    expect(describeSendError(null, "Fallo de red")).toBe("Fallo de red");
  });
});

describe("describeSendErrorText (mensaje completo de la excepción)", () => {
  it("el fallo real del cotizador: error #100 de HUMAN_AGENT", () => {
    const raw =
      'SendError: (#100) No se puede agregar la etiqueta "HUMAN_AGENT" antes de 24 horas.';
    const out = describeSendErrorText(raw);
    expect(out).toMatch(/etiqueta HUMAN_AGENT/);
    expect(out).toMatch(/te escriba primero/i);
    // la jerga cruda de Meta no debería ser lo primero que ve el operador
    expect(out).not.toMatch(/No se puede agregar la etiqueta "HUMAN_AGENT" antes/);
    expect(out).toContain("(Meta 100)");
  });

  it("acepta los tres formatos en que Meta escribe el código", () => {
    expect(describeSendErrorText("(#131047) eror")).toMatch(/24 h/);
    expect(describeSendErrorText("(Meta 131047) eror")).toMatch(/24 h/);
    expect(describeSendErrorText("fallo con código 131047")).toMatch(/24 h/);
  });

  it("sin código reconocido → texto original, sin inventar", () => {
    expect(describeSendErrorText("Cotización no encontrada")).toBe(
      "Cotización no encontrada"
    );
    expect(describeSendErrorText("Error de red")).toBe("Error de red");
  });

  it("quita el prefijo del nombre de la excepción", () => {
    expect(describeSendErrorText("SendError: (#130472) x")).not.toMatch(/^SendError/);
  });
});
