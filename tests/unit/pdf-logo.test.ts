import { describe, expect, it } from "vitest";
import { svgToPng } from "@/server/documents/pdf";

/**
 * Los logos SVG se rasterizan antes de entrar a los PDF (pdf-lib solo admite
 * PNG/JPEG): es lo que hace que cotizaciones, proyectos y balance compartan el
 * mismo logo sin importar el formato subido.
 */
describe("svgToPng", () => {
  it("convierte un SVG en PNG embebible", () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
        '<rect width="64" height="64" fill="#0d5bff"/>' +
        '<circle cx="32" cy="32" r="18" fill="#ffffff"/>' +
        "</svg>"
    );
    const png = svgToPng(svg);
    expect(png).not.toBeNull();
    // Firma PNG: 89 50 4E 47 0D 0A 1A 0A
    expect(Buffer.from(png!.subarray(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png!.length).toBeGreaterThan(100);
  });

  it("rasteriza el texto del SVG cuando hay tipografías disponibles", () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60">' +
        '<text x="10" y="40" font-size="32" fill="#111">LUMARK</text>' +
        "</svg>"
    );
    const png = svgToPng(svg);
    expect(png).not.toBeNull();
    expect(png!.length).toBeGreaterThan(100);
  });

  it("devuelve null si el SVG no se puede rasterizar", () => {
    expect(svgToPng(Buffer.from("esto no es un svg"))).toBeNull();
  });
});
