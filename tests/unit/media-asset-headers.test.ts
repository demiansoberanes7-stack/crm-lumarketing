import { describe, expect, it } from "vitest";
import { assetContentType, assetViewHeaders } from "@/server/media-path";

/**
 * El adjunto de WhatsApp llega con el MIME que eligió QUIEN LO ENVÍO:
 * `media.mime_type` del payload (`src/server/inbox/ingest.ts`) o el
 * `content-type` de la respuesta remota (`src/server/whatsapp/media.ts`). La
 * ruta `/api/media/[assetId]` lo reenviaba tal cual con `inline`, así que un
 * número cualquiera podía dejar en la bandeja un adjunto `text/html` y que el
 * dueño, al abrirlo en una pestaña desde la propia Bandeja, ejecutara ese HTML
 * con sus cookies de sesión.
 *
 * No hace falta ser el remitente para recibir el castigo: basta con que el
 * archivo se vea en el origen del CRM.
 */
describe("assetContentType", () => {
  it("deja ver lo que es multimedia o PDF, que es para lo que se abrió el enlace", () => {
    expect(assetContentType("image/jpeg")).toBe("image/jpeg");
    expect(assetContentType("image/png")).toBe("image/png");
    expect(assetContentType("image/webp")).toBe("image/webp");
    expect(assetContentType("video/mp4")).toBe("video/mp4");
    expect(assetContentType("audio/ogg")).toBe("audio/ogg");
    expect(assetContentType("application/pdf")).toBe("application/pdf");
  });

  it("aplana a octeto opaco cualquier tipo que el navegador interpretaría como documento", () => {
    expect(assetContentType("text/html")).toBe("application/octet-stream");
    expect(assetContentType("application/xhtml+xml")).toBe("application/octet-stream");
    expect(assetContentType("text/javascript")).toBe("application/octet-stream");
    expect(assetContentType("application/xml")).toBe("application/octet-stream");
    // El SVG es imagen para `<img>` y documento ejecutable en una pestaña.
    expect(assetContentType("image/svg+xml")).toBe("application/octet-stream");
  });

  it("sobrevive parámetros, mayúsculas y la ausencia de MIME", () => {
    expect(assetContentType("text/html; charset=utf-8")).toBe("application/octet-stream");
    expect(assetContentType("IMAGE/JPEG")).toBe("image/jpeg");
    expect(assetContentType(null)).toBe("application/octet-stream");
    expect(assetContentType("   ")).toBe("application/octet-stream");
  });
});

describe("assetViewHeaders", () => {
  it("un adjunto HTML se baja como archivo, no se muestra", () => {
    const h = assetViewHeaders("text/html", "factura.html");
    expect(h["content-type"]).toBe("application/octet-stream");
    expect(h["content-disposition"]).toBe(`attachment; filename="factura.html"`);
    expect(h["x-content-type-options"]).toBe("nosniff");
  });

  it("la imagen del chat sí se muestra en línea y conserva su nombre", () => {
    const h = assetViewHeaders("image/jpeg", "foto.jpeg");
    expect(h["content-type"]).toBe("image/jpeg");
    expect(h["content-disposition"]).toBe(`inline; filename="foto.jpeg"`);
  });

  it("sin nombre de archivo no emite content-disposition (como antes)", () => {
    expect(assetViewHeaders("image/png", null)["content-disposition"]).toBeUndefined();
  });

  it("el nombre sigue sanitizándose: nada de saltos de línea en la cabecera", () => {
    const h = assetViewHeaders("image/png", 'a"\r\nX-Evil: si.png');
    expect(h["content-disposition"]).not.toMatch(/\r|\n/);
    expect(h["content-disposition"]).toContain("filename=");
  });

  it("el caché sigue siendo privado por sesión", () => {
    expect(assetViewHeaders("image/png", "a.png")["cache-control"]).toBe("private, max-age=86400");
  });
});
