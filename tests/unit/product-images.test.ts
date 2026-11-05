import { describe, expect, it, vi } from "vitest";

/**
 * Fotos de producto: lo que decide si un archivo entra en el disco del negocio.
 *
 * El caso que importa de cada grupo es el que el endpoint viejo aceptaba: un
 * `content-type` declarado y unos bytes que no eran una foto. Aquí el tipo sale
 * SOLO de los primeros bytes, así que hay que fijar las cabeceras reales de los
 * cuatro formatos, no un muñeco con la firma.
 *
 * Las cotas se leen del entorno y se prueban en las orillas; en una prueba de
 * unidad no hay entorno real, así que se fija: 2 MB y 3 fotos por producto.
 */
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    PRODUCT_IMAGE_MAX_BYTES_MB: 2,
    PRODUCT_IMAGE_MAX_PER_PRODUCT: 3,
  }),
}));

const {
  catalogImagePath,
  catalogImageUrl,
  checkProductImageUpload,
  isProductImageMime,
  MAX_ALT_TEXT,
  normalizeAltText,
  PRODUCT_IMAGE_MIMES,
  sniffProductImage,
} = await import("@/lib/product-images");

type Checked = ReturnType<typeof checkProductImageUpload>;

const bytes = (...v: number[]) => Uint8Array.from(v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const pad = (head: Uint8Array | number[], total: number) =>
  Uint8Array.from([...head, ...Array(Math.max(0, total - head.length)).fill(0)]);
const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];

/** PNG: firma (8) + longitud de cabecera (4) + «IHDR» (4) + ancho (4) + alto (4). */
const png = (w: number, h: number) =>
  pad(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii("IHDR"), ...be32(w), ...be32(h)],
    64
  );

/**
 * JPEG: FF D8 FF + APP0 de 16 bytes + SOF0.
 *
 * El SOF no tiene posición fija —por eso `jpegDimensions` camina segmentos
 * saltando la longitud declarada—, así que este fixture ejercita el recorrido
 * completo: altura y anchura viajan en big-endian a p+5..p+8.
 */
const jpeg = (w: number, h: number) =>
  pad(
    [
      0xff,
      0xd8,
      0xff,
      0xe0,
      ...be16(16),
      ...ascii("JFIF\x00"),
      1,
      1,
      0,
      ...be16(1),
      ...be16(1),
      0,
      0,
      0xff,
      0xc0,
      ...be16(17),
      8,
      ...be16(h),
      ...be16(w),
    ],
    64
  );

/** WEBP con pérdida: tag de 3 bytes, código sincrónico 9D 01 2A y tamaños LE de 16. */
const webpLossy = (w: number, h: number) =>
  pad(
    [
      ...ascii("RIFF"),
      ...le32(0),
      ...ascii("WEBP"),
      ...ascii("VP8 "),
      ...le32(20),
      0,
      0,
      0,
      0x9d,
      0x01,
      0x2a,
      ...le16(w),
      ...le16(h),
    ],
    64
  );

/** WEBP extendido: flags + canvas «menos uno» en LE de 24 bits, dos veces. */
const webpExtended = (w: number, h: number) =>
  pad(
    [
      ...ascii("RIFF"),
      ...le32(0),
      ...ascii("WEBP"),
      ...ascii("VP8X"),
      ...le32(10),
      0,
      0,
      0,
      0,
      ...le24(w - 1),
      ...le24(h - 1),
    ],
    64
  );

/** WEBP sin pérdida: firma 0x2f y ancho-1 / alto-1 como 14 bits contiguos. */
const webpLossless = (w: number, h: number) => {
  const packed = (w - 1) | ((h - 1) << 14);
  return pad(
    [
      ...ascii("RIFF"),
      ...le32(0),
      ...ascii("WEBP"),
      ...ascii("VP8L"),
      ...le32(8),
      0x2f,
      packed & 0xff,
      (packed >>> 8) & 0xff,
      (packed >>> 16) & 0xff,
    ],
    64
  );
};

const gif = (w: number, h: number) => pad([...ascii("GIF89a"), ...le16(w), ...le16(h)], 64);

describe("sniffProductImage: el tipo sale de los bytes", () => {
  it.each([
    ["PNG", png(800, 600)],
    ["JPEG", jpeg(800, 600)],
    ["WEBP con pérdida", webpLossy(800, 600)],
    ["WEBP extendido", webpExtended(800, 600)],
    ["WEBP sin pérdida", webpLossless(800, 600)],
    ["GIF", gif(800, 600)],
  ] as const)("%s se reconoce con sus dimensiones reales", (_label, file) => {
    const image = sniffProductImage(file)!;
    expect(image.width).toBe(800);
    expect(image.height).toBe(600);
    expect(PRODUCT_IMAGE_MIMES).toContain(image.mime);
  });

  it("cada formato devuelve su MIME exacto", () => {
    expect(sniffProductImage(png(1, 1))!.mime).toBe("image/png");
    expect(sniffProductImage(jpeg(1, 1))!.mime).toBe("image/jpeg");
    expect(sniffProductImage(webpLossy(1, 1))!.mime).toBe("image/webp");
    expect(sniffProductImage(gif(1, 1))!.mime).toBe("image/gif");
  });

  it("al WEBP extendido hay que devolverle el uno que guarda de menos", () => {
    expect(sniffProductImage(webpExtended(1024, 768))).toEqual({
      mime: "image/webp",
      width: 1024,
      height: 768,
    });
  });

  it("un SVG que se haga pasar por foto no entra", () => {
    // El logo del negocio sí admite SVG; una foto de producto no. Un SVG es un
    // documento, se sirve desde la raíz del CRM y quien lo abre tiene sesión.
    expect(
      sniffProductImage(bytes(...ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')))
    ).toBeNull();
  });

  it("un HTML o un PDF declarado image/png se rechaza", () => {
    expect(sniffProductImage(bytes(...ascii("<html><script>alert(1)</script></html>")))).toBeNull();
    expect(sniffProductImage(bytes(...ascii("%PDF-1.7")))).toBeNull();
  });

  it("la firma manda sobre lo que dijera el content-type", () => {
    // Lo que hacía `/api/media/upload`: fiarse de `file.type` sin mirar un byte.
    // Aquí no entra ningún parámetro de tipo, así que no hay en qué mentir.
    expect(sniffProductImage(bytes(...ascii("GIFAR;bang!")))).toBeNull();
    expect(sniffProductImage(bytes(...ascii("MZ\x90\x00\x03\x00\x00\x00\x04\x00")))).toBeNull();
  });

  it("vacío o más corto que la firma no es nada", () => {
    expect(sniffProductImage(bytes())).toBeNull();
    expect(sniffProductImage(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
  });

  it("PNG sin IHDR como primera cabecera sigue siendo PNG, solo pierde medidas", () => {
    const tEXt = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(9), ...ascii("iTXt"), 0, 0, 0, 1], 64);
    expect(sniffProductImage(tEXt)).toEqual({ mime: "image/png", width: null, height: null });
  });

  it("JPEG con una longitud de segmento imposible no se sale del archivo", () => {
    // APP0 que declara 1 byte: el recorrido para ahí y la imagen se guarda igual,
    // porque la firma ya dijo que es JPEG.
    const broken = bytes(
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xda
    );
    expect(sniffProductImage(broken)).toEqual({ mime: "image/jpeg", width: null, height: null });
  });

  it("los marcadores sin longitud (RST*) se saltan de a dos", () => {
    // Si el recorrido leyera longitud después de un RST0 caería dentro de los
    // bytes comprimidos y saldría cualquier cosa.
    const withRst = bytes(
      0xff, 0xd8, 0xff, 0xd0, 0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(360), ...be16(640), 0, 0, 0, 0, 0
    );
    expect(sniffProductImage(withRst)).toEqual({ mime: "image/jpeg", width: 640, height: 360 });
  });

  it("un JPEG cuyo SOF cae después del inicio de escaneo no inventa medidas", () => {
    const sosFirst = bytes(
      0xff, 0xd8, 0xff, 0xdb, 0x00, 0x05, 0x01, 0x00, 0x00,
      0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
      ...be16(9999), ...be16(8888), 0, 0, 0, 0
    );
    const image = sniffProductImage(sosFirst)!;
    expect(image.mime).toBe("image/jpeg");
    expect(image.width).toBeNull();
    expect(image.height).toBeNull();
  });

  it("las medidas de un JPEG truncado no se leen fuera del búfer", () => {
    // SOF0 recortado: el ancho cae en 0, y un ancho 0 no es una medida. La firma
    // manda y la foto se guarda; las dimensiones se quedan en null.
    const truncated = bytes(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x01, 0x00, 0x00, 0x00);
    expect(sniffProductImage(truncated)).toEqual({ mime: "image/jpeg", width: null, height: null });
  });

  it("un archivo más corto que cualquier cabecera útil se descarta", () => {
    // Contrapartida del tope de 12 bytes: un JPEG de 8 sí empieza como JPEG pero
    // no puede ser una foto, y rechazarlo cuesta menos que servir un roto.
    expect(sniffProductImage(bytes(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02))).toBeNull();
  });
});

describe("isProductImageMime", () => {
  it("acepta los cuatro del catálogo y nada más", () => {
    expect(isProductImageMime("image/png")).toBe(true);
    expect(isProductImageMime("image/jpeg")).toBe(true);
    expect(isProductImageMime("image/svg+xml")).toBe(false);
    expect(isProductImageMime("application/octet-stream")).toBe(false);
  });
});

describe("checkProductImageUpload: las orillas de los límites", () => {
  const ok = png(4, 4);
  const rejection = (r: Checked) => ("rejection" in r ? r.rejection : null);

  it("deja pasar una foto válida con hueco", () => {
    expect(checkProductImageUpload(ok, 0)).toEqual({ image: { mime: "image/png", width: 4, height: 4 } });
  });

  it("el archivo vacío no es una imagen", () => {
    expect(rejection(checkProductImageUpload(bytes(), 0))?.code).toBe("not_an_image");
  });

  it("pasa justo en el tope de bytes y falla en el siguiente", () => {
    const lim = 2 * 1024 * 1024;
    expect("image" in checkProductImageUpload(pad(png(4, 4), lim), 0)).toBe(true);
    const over = rejection(checkProductImageUpload(pad(png(4, 4), lim + 1), 0))!;
    expect(over.code).toBe("too_large");
    expect(over.message).toContain("2 MB");
  });

  it("el tamaño se comprueba antes de mirar qué es", () => {
    // Un ejecutable gigante debe decir «demasiado grande», no «no es una imagen»
    // ni recorrer sus 2 MB buscando una firma.
    const huge = pad([...ascii("MZ\x90\x00"), 0, 0, 0, 0, 0], 2 * 1024 * 1024 + 1);
    expect(rejection(checkProductImageUpload(huge, 0))?.code).toBe("too_large");
  });

  it("pasa con el último hueco y falla cuando el producto ya está lleno", () => {
    expect("image" in checkProductImageUpload(ok, 2)).toBe(true);
    const full = rejection(checkProductImageUpload(ok, 3))!;
    expect(full.code).toBe("limit_reached");
    expect(full.message).toContain("3 fotos");
  });

  it("lo que no es foto se rechaza aunque no se pase de ningún tope", () => {
    expect(rejection(checkProductImageUpload(bytes(...ascii("<html/>")), 0))?.code).toBe("not_an_image");
  });
});

describe("ruta y URL derivadas", () => {
  it("la extensión sale del MIME detectado, nunca del nombre original", () => {
    // El nombre lo escribe quien sube; si entrara en la ruta sería la puerta de
    // `/`, de `..` o de un doble sufijo `.html.png`.
    expect(catalogImagePath("pimg_abc", "image/jpeg")).toBe("catalog/pimg_abc.jpg");
    expect(catalogImagePath("pimg_abc", "image/png")).toBe("catalog/pimg_abc.png");
    expect(catalogImagePath("pimg_abc", "image/webp")).toBe("catalog/pimg_abc.webp");
    expect(catalogImagePath("pimg_abc", "image/gif")).toBe("catalog/pimg_abc.gif");
  });

  it("la URL cuelga del prefijo público de media", () => {
    expect(catalogImageUrl("org_1", "catalog/pimg_abc.jpg")).toBe("/api/media/public/org_1/catalog/pimg_abc.jpg");
  });
});

describe("normalizeAltText", () => {
  it("colapsa espacios y recorta a la cota de la columna", () => {
    expect(normalizeAltText("  silla   de \n madera ")).toBe("silla de madera");
    expect(normalizeAltText("a".repeat(900))).toHaveLength(MAX_ALT_TEXT);
  });

  it("vacío o solo espacios no deja una cadena vacía en la ficha del bot", () => {
    expect(normalizeAltText("")).toBeNull();
    expect(normalizeAltText("   \n\t ")).toBeNull();
    expect(normalizeAltText(null)).toBeNull();
    expect(normalizeAltText(undefined)).toBeNull();
  });
});
