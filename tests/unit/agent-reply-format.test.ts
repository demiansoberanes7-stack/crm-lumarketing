import { describe, expect, it } from "vitest";
import {
  fitsChannel,
  formatAgentReply,
  supportsWhatsAppMarkdown,
} from "@/server/ai/reply-format";

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

describe("formatAgentReply · el quite de énfasis no rompe URLs ni SKU", () => {
  // El `_` de un enlace o de un código de producto no es cursiva: con el
  // patrón antiguo `https://tienda.com/a_b_c_x` salía `https://tienda.com/abc_x`.
  it("deja intacta una URL con guiones bajos", () => {
    const text = "Te comparto https://tienda.com/promo/a_b_c_x para más detalle";
    expect(formatAgentReply(text, "instagram")).toBe(text);
  });

  it("deja intacto un SKU en snake_case", () => {
    const text = "El modelo sku_12_34 cuesta $199 con instalación incluida";
    expect(formatAgentReply(text, "instagram")).toBe(text);
  });

  it("sí quita un énfasis legítimo entre palabras", () => {
    expect(formatAgentReply("esto es _genial_ para ti", "instagram")).toBe(
      "esto es genial para ti"
    );
  });

  it("no deja espacios dobles al quitar los asteriscos", () => {
    expect(formatAgentReply("Fundas  $199   Cristales  $149", "whatsapp")).toBe(
      "Fundas $199 Cristales $149"
    );
    expect(formatAgentReply("•  Funda  $199", "whatsapp")).toBe("• Funda $199");
  });
});

describe("fitsChannel · el texto que manda el agente sí cabe en el canal", () => {
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");

  it("WhatsApp no tiene tope: manda el texto tal cual", () => {
    const long = "x".repeat(5000);
    expect(fitsChannel(long, "whatsapp")).toBe(long);
  });

  it("debajo del tope no toca nada", () => {
    expect(fitsChannel("Hola, ¿qué necesitas?", "instagram")).toBe(
      "Hola, ¿qué necesitas?"
    );
  });

  it("empieza sacrificando el aire que añadió el formateador", () => {
    const air = Array.from({ length: 100 }, (_, i) => `rengon ${i}`).join("\n\n");
    expect(bytes(air)).toBeGreaterThan(1000);
    const out = fitsChannel(air, "instagram");
    expect(out).toBe(air.replace(/\n{2,}/g, "\n"));
    expect(bytes(out)).toBeLessThanOrEqual(1000);
  });

  it("si aún no cabe, corta por renglón completo y avisa con puntos suspensivos", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `${i}`.padStart(200, "x"));
    const out = fitsChannel(lines.join("\n"), "instagram");
    expect(out).toBe(`${lines.slice(0, 4).join("\n")}\n…`);
    expect(bytes(out)).toBeLessThanOrEqual(1000);
    // El renglón que quedó fuera no se reacomoda a medias: se pierde entero.
    expect(out).not.toContain("9");
  });

  it("un renglón solo se parte por bytes sin dejar un caracter roto", () => {
    const emoji = "😀".repeat(500);
    const out = fitsChannel(emoji, "tiktok");
    expect(bytes(out)).toBeLessThanOrEqual(1000);
    expect(out).toContain("😀");
    expect(out).not.toContain("\uFFFD");
    expect(out.endsWith("…")).toBe(true);
  });
});
