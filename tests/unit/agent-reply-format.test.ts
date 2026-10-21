import { describe, expect, it } from "vitest";
import { formatAgentReply, supportsWhatsAppMarkdown } from "@/server/ai/reply-format";

/**
 * El dueño reporta que el agente manda «amontonado y feo»: el catálogo entero
 * en un párrafo corrido. El prompt pide renglones, pero el modelo no siempre
 * obedece — esta es la red determinista antes de enviar.
 */

describe("formatAgentReply · párrafos amontonados", () => {
  it("convierte una enumeración de precios en una viñeta por renglón", () => {
    const text = formatAgentReply(
      "Tenemos smartphones desde $8,999, fundas de silicona $199, cristales templados $149 y audífonos bluetooth $349.",
      "whatsapp"
    );
    expect(text.split("\n")).toEqual([
      "• Tenemos smartphones desde $8,999",
      "• fundas de silicona $199",
      "• cristales templados $149",
      "• audífonos bluetooth $349",
    ]);
  });

  it("no parte la prosa normal aunque tenga comas", () => {
    const text = "Claro, con gusto te ayudo. ¿Buscas algo para ti o para regalo?";
    expect(formatAgentReply(text, "whatsapp")).toBe(text);
  });

  it("no parte una enumeración con frases hechas dentro del renglón", () => {
    const text =
      "Atendemos de 9 a 6. Tenemos fundas $199, cristales $149, audífonos $349.";
    expect(formatAgentReply(text, "whatsapp")).toBe(text);
  });

  it("deja un renglón en blanco antes del bloque de viñetas", () => {
    const text = formatAgentReply(
      "Esto es lo que tenemos:\n• Fundas $199\n• Cristales $149\n• Audífonos $349",
      "whatsapp"
    );
    expect(text).toBe(
      "Esto es lo que tenemos:\n\n• Fundas $199\n• Cristales $149\n• Audífonos $349"
    );
  });
});

describe("formatAgentReply · markdown por canal", () => {
  it("WhatsApp: **negrita** pasa a *negrita* y el título a viñeta destacada", () => {
    expect(formatAgentReply("**Cotización 12**\n## Total", "whatsapp")).toBe(
      "*Cotización 12*\n*Total*"
    );
  });

  it("Instagram y Messenger: sin negrita, los asteriscos se quitan", () => {
    expect(formatAgentReply("*Fundas* $199", "instagram")).toBe("Fundas $199");
    expect(formatAgentReply("**Fundas** $199", "messenger")).toBe("Fundas $199");
  });

  it("un enlace escrito como markdown deja el destino legible", () => {
    expect(
      formatAgentReply("Mira: [el catálogo](https://lumarketing.digital/cat)", "whatsapp")
    ).toBe("Mira: el catálogo: https://lumarketing.digital/cat");
  });

  it("solo WhatsApp renderiza negrita", () => {
    expect(supportsWhatsAppMarkdown("whatsapp")).toBe(true);
    expect(supportsWhatsAppMarkdown("tiktok")).toBe(false);
    expect(supportsWhatsAppMarkdown(undefined)).toBe(false);
  });
});

describe("formatAgentReply · limpieza", () => {
  it("colapsa los saltos dobles y quita los espacios sueltos", () => {
    expect(formatAgentReply("Hola   \n\n\n\n¿qué necesitas?  \n\n\n", "whatsapp")).toBe(
      "Hola\n\n¿qué necesitas?"
    );
  });

  it("une los marcadores de lista dispersos en una sola viñeta", () => {
    expect(formatAgentReply("- Funda $199\n* Cristal $149\n+ Audífono $349", "whatsapp")).toBe(
      "• Funda $199\n• Cristal $149\n• Audífono $349"
    );
  });

  it("corta por oraciones un renglón kilométrico", () => {
    const long = `${"x".repeat(120)}. ${"y".repeat(120)}.`;
    expect(formatAgentReply(long, "whatsapp").split("\n")).toHaveLength(2);
  });

  it("un texto vacío no manda mensaje", () => {
    expect(formatAgentReply("   \n\n  ", "whatsapp")).toBe("");
  });
});
