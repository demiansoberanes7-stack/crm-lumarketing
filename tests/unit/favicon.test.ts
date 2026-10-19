import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_MARK_BODY, BRAND_MARK_TAIL, isZorroTechName } from "@/lib/brand";
import { DEFAULT_BRANDING, normalizeBranding } from "@/lib/branding";
import {
  faviconCacheKey,
  faviconHref,
  faviconInitial,
  generatedFaviconSvg,
  isFaviconMime,
  MAX_FAVICON_BYTES,
  sniffFaviconMime,
} from "@/lib/favicon";

const bytes = (...v: number[]) => new Uint8Array(v);
const texto = (s: string) => new TextEncoder().encode(s);

describe("sniffFaviconMime (el tipo sale de los bytes)", () => {
  it("reconoce los formatos que sirve el navegador", () => {
    expect(sniffFaviconMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2))).toBe(
      "image/png"
    );
    expect(sniffFaviconMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(sniffFaviconMime(bytes(0x00, 0x00, 0x01, 0x00, 1, 0))).toBe("image/x-icon");
    // "RIFF" + 4 bytes de tamaño + "WEBPVP8 ": el tamaño viaja como bytes, no como espacios.
    expect(
      sniffFaviconMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20))
    ).toBe("image/webp");
  });

  it("acepta SVG con o sin declaración XML delante", () => {
    expect(sniffFaviconMime(texto('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(
      "image/svg+xml"
    );
    expect(
      sniffFaviconMime(texto('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"/>'))
    ).toBe("image/svg+xml");
    expect(sniffFaviconMime(texto("\n\n  <svg />"))).toBe("image/svg+xml");
  });

  it("RECHAZA lo que no es imagen, aunque lo llamen imagen", () => {
    // El caso que importa: decir `image/png` y mandar un documento. Esto se
    // sirve desde el mismo dominio, así que colarlo sería colar una página.
    expect(sniffFaviconMime(texto("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffFaviconMime(texto("GIF89a"))).toBeNull(); // formato no soportado
    expect(sniffFaviconMime(texto("%PDF-1.7"))).toBeNull();
    expect(sniffFaviconMime(bytes())).toBeNull();
    expect(sniffFaviconMime(bytes(0x89, 0x50))).toBeNull(); // PNG truncado
  });

  it("un `<html>` con un `<svg>` dentro no pasa por SVG", () => {
    expect(
      sniffFaviconMime(texto("<html><body><svg onload='x()'/></body></html>"))
    ).toBeNull();
  });
});

describe("isFaviconMime", () => {
  it("acepta los del catálogo y nada más", () => {
    expect(isFaviconMime("image/png")).toBe(true);
    expect(isFaviconMime("image/svg+xml")).toBe(true);
    expect(isFaviconMime("text/html")).toBe(false);
    expect(isFaviconMime("image/gif")).toBe(false);
  });
});

describe("icono generado", () => {
  it("dibuja la inicial del nombre", () => {
    expect(faviconInitial("Ferretería El Martillo")).toBe("F");
    expect(faviconInitial("  acme  ")).toBe("A");
  });

  it("un nombre vacío no deja la pestaña sin letra", () => {
    expect(faviconInitial("")).toBe("Z");
    expect(faviconInitial("   ")).toBe("Z");
  });

  it("es un SVG con el acento de la marca", () => {
    const svg = generatedFaviconSvg({ ...DEFAULT_BRANDING, name: "Acme" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(">A<");
    expect(svg).toContain(DEFAULT_BRANDING.accent);
  });

  it("escapa un nombre que empiece por un carácter de marcado", () => {
    // Sin esto, un nombre así rompería el SVG que se sirve.
    const svg = generatedFaviconSvg({ ...DEFAULT_BRANDING, name: "<b>" });
    expect(svg).toContain("&lt;");
    expect(svg).not.toContain("><<");
  });
});

describe("icono generado: la marca Zorro Tech", () => {
  it("con el nombre Zorro Tech dibuja la Z, no una letra", () => {
    const svg = generatedFaviconSvg(DEFAULT_BRANDING);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(BRAND_MARK_BODY);
    expect(svg).toContain(BRAND_MARK_TAIL);
    expect(svg).not.toContain("<text");
  });

  it("el degradado del mosaico sigue al acento de la instancia", () => {
    const svg = generatedFaviconSvg({ ...DEFAULT_BRANDING, accent: "#3f5972" });
    expect(svg).toContain("#3f5972");
    expect(svg).toContain(BRAND_MARK_BODY);
  });

  it("solo se llama Zorro Tech quien se llama así: sin importar mayúsculas ni espacios", () => {
    expect(isZorroTechName("ZORRO TECH")).toBe(true);
    expect(isZorroTechName("  zorro   tech ")).toBe(true);
    expect(isZorroTechName("Zorro")).toBe(true);
    expect(isZorroTechName("Acme")).toBe(false);
  });

  it("una instancia rebautizada NO ve la Z de Zorro Tech en su pestaña", () => {
    const svg = generatedFaviconSvg({ ...DEFAULT_BRANDING, name: "Acme" });
    expect(svg).not.toContain(BRAND_MARK_BODY);
    expect(svg).toContain(">A<");
  });
});

describe("faviconCacheKey (los navegadores no sueltan el favicon solo)", () => {
  it("cambia si cambia el nombre o el acento", () => {
    const a = { ...DEFAULT_BRANDING, name: "Acme" };
    expect(faviconCacheKey(a)).not.toBe(
      faviconCacheKey({ ...a, name: "Otra" })
    );
    expect(faviconCacheKey(a)).not.toBe(
      faviconCacheKey({ ...a, accent: "#4b5563" })
    );
  });

  it("y cambia con cada carga del logo subido", () => {
    const base = { ...DEFAULT_BRANDING };
    const v1 = faviconCacheKey({ ...base, favicon: { mime: "image/png", version: 1 } });
    const v2 = faviconCacheKey({ ...base, favicon: { mime: "image/png", version: 2 } });
    expect(v1).not.toBe(v2);
  });

  it("el subido y el generado nunca comparten clave", () => {
    const generado = faviconCacheKey(DEFAULT_BRANDING);
    const subido = faviconCacheKey({
      ...DEFAULT_BRANDING,
      favicon: { mime: "image/png", version: 1 },
    });
    expect(generado.startsWith("g")).toBe(true);
    expect(subido.startsWith("u")).toBe(true);
  });

  it("faviconHref cuelga la clave de la ruta pública", () => {
    expect(faviconHref(DEFAULT_BRANDING)).toMatch(
      /^\/api\/branding\/favicon\?v=g[0-9a-z]+$/
    );
  });
});

describe("normalizeBranding con icono", () => {
  it("una marca sin icono queda en null, no en undefined", () => {
    expect(normalizeBranding({ name: "Acme" }).favicon).toBeNull();
  });

  it("conserva un icono bien formado", () => {
    const b = normalizeBranding({
      name: "Acme",
      favicon: { mime: "image/png", version: 3 },
    });
    expect(b.favicon).toEqual({ mime: "image/png", version: 3 });
  });

  it("descarta basura guardada en metadata", () => {
    expect(
      normalizeBranding({ favicon: { mime: "image/png" } as never }).favicon
    ).toBeNull();
    expect(normalizeBranding({ favicon: "sí" as never }).favicon).toBeNull();
  });
});

describe("tope de tamaño", () => {
  it("son 256 KB: un favicon de más no existe", () => {
    expect(MAX_FAVICON_BYTES).toBe(262144);
  });
});

describe("favicon estático (respaldo local)", () => {
  it("public/favicon.ico existe y es un ICO de verdad", () => {
    // Sin esto, un bot o un crawer que pida /favicon.ico directo se queda con 404;
    // el generado por /api/branding/favicon no lo alcanza.
    const bytes = readFileSync(join(process.cwd(), "public", "favicon.ico"));
    expect(bytes.length).toBeGreaterThan(0);
    expect(sniffFaviconMime(new Uint8Array(bytes))).toBe("image/x-icon");
  });
});
