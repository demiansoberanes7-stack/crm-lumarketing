import { describe, expect, it } from "vitest";
import { emailSnippet, parseEmailBody } from "@/lib/email-format";

describe("lectura de correo: cuerpo, firma e historial", () => {
  it("separa la respuesta del historial citado en español", () => {
    const parsed = parseEmailBody(
      [
        "Gracias, lo reviso hoy mismo.",
        "",
        "El lun, 12 oct 2026 a las 10:15, Ana Pérez escribió:",
        "> ¿Me confirmas el precio?",
        "> Quedo atenta.",
      ].join("\n")
    );
    expect(parsed.main).toBe("Gracias, lo reviso hoy mismo.");
    expect(parsed.quoted).toContain("¿Me confirmas el precio?");
    expect(parsed.quoted).not.toContain(">");
  });

  it("separa el bloque de cabeceras de Outlook", () => {
    const parsed = parseEmailBody(
      [
        "Perfecto, queda agendado.",
        "",
        "De: Carlos Ruiz",
        "Enviado: lunes, 12 de octubre de 2026 09:00",
        "Para: ventas@lumarketing.digital",
        "Asunto: Cotización",
        "",
        "Texto anterior.",
      ].join("\n")
    );
    expect(parsed.main).toBe("Perfecto, queda agendado.");
    expect(parsed.quoted).toContain("Texto anterior.");
  });

  it("separa la firma tras la línea de guiones", () => {
    const parsed = parseEmailBody(
      ["Quedamos en contacto.", "", "-- ", "Ana Pérez", "Lumarketing · 555 123 4567"].join(
        "\n"
      )
    );
    expect(parsed.main).toBe("Quedamos en contacto.");
    expect(parsed.signature).toContain("Ana Pérez");
    expect(parsed.quoted).toBeNull();
  });

  it("no parte un mensaje que empieza siendo una cita", () => {
    const parsed = parseEmailBody(
      ["El lun, 12 oct 2026, Ana escribió:", "> Hola", "> ¿Sigues ahí?"].join("\n")
    );
    expect(parsed.main).toContain("¿Sigues ahí?");
    expect(parsed.quoted).toBeNull();
  });

  it("deja intacto un correo sin cita ni firma", () => {
    const parsed = parseEmailBody("Hola.\n\nTe mando la propuesta.\n\nSaludos.");
    expect(parsed.main).toBe("Hola.\n\nTe mando la propuesta.\n\nSaludos.");
    expect(parsed.signature).toBeNull();
    expect(parsed.quoted).toBeNull();
  });

  it("el snippet de la lista no arrastra el historial citado", () => {
    const snippet = emailSnippet(
      [
        "Confirmado para el jueves.",
        "",
        "El vie, 9 oct 2026 escribió:",
        "> bla bla bla bla bla bla bla bla bla bla",
      ].join("\n")
    );
    expect(snippet).toBe("Confirmado para el jueves.");
  });

  it("maneja cuerpo vacío", () => {
    const parsed = parseEmailBody(null);
    expect(parsed).toEqual({ main: "", signature: null, quoted: null });
    expect(emailSnippet(null)).toBe("");
  });
});
