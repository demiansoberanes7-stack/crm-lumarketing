import { describe, expect, it } from "vitest";
import { commentBodyText } from "@/lib/comments-format";

describe("texto de un comentario en la Bandeja", () => {
  it("quita la cabecera «sobre:» que guardaban los comentarios viejos", () => {
    const caption = "Nuevo en el menú: café de especialidad";
    expect(
      commentBodyText(
        `sobre: ${caption}\n\n¿Cuánto cuesta el café?`,
        caption
      )
    ).toBe("¿Cuánto cuesta el café?");
  });

  it("respeta un comentario que empieza con «sobre:» por casualidad", () => {
    const caption = "Promoción de octubre";
    const text = "sobre: esto quiero saber\n\n¿Sigue vigente?";
    expect(commentBodyText(text, caption)).toBe(text);
  });

  it("limpia una cabecera que solo coincide con el inicio del caption", () => {
    const caption = "Nuevo en el menú: café de especialidad de Chiapas, tueste medio y notas a chocolate. Disponible toda la semana.";
    expect(
      commentBodyText(
        "sobre: Nuevo en el menú: café de especialidad de Chiapas, tueste medio y notas a chocolate.\n\n¿Cuánto cuesta?",
        caption
      )
    ).toBe("¿Cuánto cuesta?");
  });

  it("recorta el caption cuando se guardó truncado a 120 caracteres", () => {
    const caption = "x".repeat(200);
    const text = `sobre: ${"x".repeat(120)}…\n\nComentario real`;
    expect(commentBodyText(text, caption)).toBe("Comentario real");
  });

  it("deja el texto tal cual si no hay caption o no hay prefijo", () => {
    expect(commentBodyText("Hola", null)).toBe("Hola");
    expect(commentBodyText("Hola", "Publicación")).toBe("Hola");
    expect(commentBodyText(null, "Publicación")).toBe("");
  });
});
