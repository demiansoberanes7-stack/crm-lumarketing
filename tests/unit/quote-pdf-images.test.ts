import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { svgToPng } from "@/server/documents/pdf";

/**
 * La foto congelada en la partida, dentro del PDF de la cotización.
 *
 * Aquí se fija lo que no se puede fijar mirando el código: que la miniatura
 * entre, que no entre cuando no debe (formato que pdf-lib no admite, archivo
 * que ya no está, presupuesto agotado) y que el texto de la partida se mueva
 * al ancho de la columna de fotos en vez de montarse encima.
 *
 * No hay navegador ni servidor: se genera un PNG de verdad con el mismo
 * rasterizador que usa el logo del negocio y se lee el PDF como texto —
 * pdf-lib escribe los flujos sin comprimir, así que la posición de cada renglón
 * y el número de imágenes se pueden contar.
 */

const mocks = vi.hoisted(() => ({
  getQuote: vi.fn(),
  getBusinessSettings: vi.fn(),
  getBranding: vi.fn(),
}));

vi.mock("@/server/quotes/service", () => ({ getQuote: mocks.getQuote }));
vi.mock("@/server/business-settings", () => ({ getBusinessSettings: mocks.getBusinessSettings }));
vi.mock("@/server/branding", () => ({ getBranding: mocks.getBranding }));

const { quotePdf } = await import("@/server/quotes/pdf");

const ORG = "org_zorro";

const item = (over: Record<string, unknown> = {}) => ({
  id: "qi_1",
  quoteId: "qt_1",
  productId: "cat_1",
  name: "Teclado mecánico",
  description: null,
  longDescription: null,
  quantity: 1,
  unitPrice: 100000,
  imageStoragePath: null,
  imageMimeType: null,
  imageBytes: null,
  ...over,
});

function quoteFixture(items: Record<string, unknown>[]) {
  return {
    quoteNumber: "COT-0004",
    createdAt: new Date("2026-11-03T12:00:00Z"),
    validUntil: new Date("2026-12-03T12:00:00Z"),
    contactName: "Ana López",
    contactEmail: null,
    contactPhone: "55 1111 2222",
    message: "Entrega en 48 horas",
    paymentMethod: null,
    items,
    subtotal: 100000,
    discountType: null,
    discountValue: null,
    discountAmount: 0,
    taxRate: 16,
    taxAmount: 16000,
    total: 116000,
  };
}

const countImages = (bytes: Uint8Array) =>
  (Buffer.from(bytes).toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;

/**
 * pdf-lib guarda los flujos del PDF comprimidos; para poder leer la geometría
 * se descomprime cada flujo con zlib. Los que no son texto (la foto, que viaja
 * con su propio filtro) se dejan crudos.
 */
function flattened(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const parts: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      parts.push(inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1"));
    } catch {
      parts.push(m[1]!);
    }
  }
  return parts.join("\n");
}

/** Coordenadas x de cada renglón de texto (`1 0 0 1 x y Tm`). */
const textXPositions = (bytes: Uint8Array) =>
  [...flattened(bytes).matchAll(/1 0 0 1 ([0-9.]+) [0-9.]+ Tm/g)].map((m) => Number(m[1]));

/**
 * Dónde se coloca cada miniatura. pdf-lib dibuja una imagen con la matriz de
 * posición seguida de una matriz identidad (`1 0 0 1 0 0 cm`) y después su
 * escala; el texto nunca produce ese patrón.
 */
const imagePlacements = (bytes: Uint8Array) =>
  [
    ...flattened(bytes).matchAll(
      /q\n1 0 0 1 ([0-9.+-]+) ([0-9.+-]+) cm\n1 0 0 1 0 0 cm\n/g
    ),
  ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

let root: string;
/** PNG real (rectángulo azul) escrito en el volumen de media del negocio. */
async function writePhoto(name: string) {
  const png = await svgToPng(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60">' +
        '<rect width="80" height="60" fill="#1d4ed8"/></svg>'
    )
  );
  expect(png).not.toBeNull();
  const absolute = join(root, ORG, "catalog");
  mkdirSync(absolute, { recursive: true });
  writeFileSync(join(absolute, name), png!);
  return { imageStoragePath: `catalog/${name}`, imageMimeType: "image/png", imageBytes: png!.length };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zorro-quote-pdf-"));
  process.env.MEDIA_DIR = root;
  mocks.getBusinessSettings.mockResolvedValue({
    companyName: "Zorro Tech",
    logoUrl: undefined,
    email: "hola@zorro.mx",
    phone: "55 0000 0000",
    rfc: null,
    address: null,
    website: null,
  });
  mocks.getBranding.mockResolvedValue({ pdfColors: { header: "#F97316", accent: "#111111" } });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("la miniatura en la partida", () => {
  it("entra cuando la partida trae su foto congelada", async () => {
    const photo = await writePhoto("pimg_1.png");
    mocks.getQuote.mockResolvedValue(quoteFixture([item(photo)]));
    const pdf = await quotePdf(ORG, "qt_1");
    expect(pdf).not.toBeNull();
    expect(countImages(pdf!.bytes)).toBe(1);
  });

  it("no hay ninguna imagen si ninguna partida tiene foto", async () => {
    mocks.getQuote.mockResolvedValue(quoteFixture([item(), item({ id: "qi_2" })]));
    const pdf = await quotePdf(ORG, "qt_1");
    expect(countImages(pdf!.bytes)).toBe(0);
  });

  it("el mismo producto en dos partidas se embebe una sola vez", async () => {
    const photo = await writePhoto("pimg_2.png");
    mocks.getQuote.mockResolvedValue(
      quoteFixture([item(photo), item({ id: "qi_2", ...photo })])
    );
    const pdf = await quotePdf(ORG, "qt_1");
    expect(countImages(pdf!.bytes)).toBe(1);
  });

  it("el texto se mueve a la columna de fotos, no se monta encima", async () => {
    // MARGIN 50 + 8 = 58 sin foto; con foto la descripción corre 56 pt más.
    mocks.getQuote.mockResolvedValue(quoteFixture([item()]));
    expect(textXPositions((await quotePdf(ORG, "qt_1"))!.bytes)).toContain(58);

    const photo = await writePhoto("pimg_3.png");
    mocks.getQuote.mockResolvedValue(quoteFixture([item(photo)]));
    const pdf = (await quotePdf(ORG, "qt_1"))!;
    const xs = textXPositions(pdf.bytes);
    expect(xs).toContain(114);
    expect(xs).not.toContain(58);
    // La miniatura ocupa su columna justa: arranca en el margen (58) y su borde
    // derecho (58 + 46 = 104) queda antes del texto (114).
    const places = imagePlacements(pdf.bytes);
    expect(places.map((p) => p.x)).toEqual([58]);
    expect(Math.max(...places.map((p) => p.x)) + 46).toBeLessThanOrEqual(114);
  });

  it("una partida sin foto deja la columna igualmente para las que sí la tienen", async () => {
    const photo = await writePhoto("pimg_4.png");
    mocks.getQuote.mockResolvedValue(
      quoteFixture([item(), item({ id: "qi_2", name: "Ratón", ...photo })])
    );
    const pdf = (await quotePdf(ORG, "qt_1"))!;
    const xs = textXPositions(pdf.bytes);
    // Una sola foto, pero las dos partidas sangran al mismo ancho.
    expect(countImages(pdf.bytes)).toBe(1);
    expect(xs).toContain(114);
    expect(xs).not.toContain(58);
  });
});

describe("lo que hace que una partida salga sin foto", () => {
  it("webp y gif no los admite pdf-lib", async () => {
    const photo = await writePhoto("pimg_5.png");
    mocks.getQuote.mockResolvedValue(
      quoteFixture([
        item({ ...photo, imageMimeType: "image/webp" }),
        item({ id: "qi_2", ...photo, imageMimeType: "image/gif" }),
      ])
    );
    const pdf = await quotePdf(ORG, "qt_1");
    expect(pdf).not.toBeNull();
    expect(countImages(pdf!.bytes)).toBe(0);
  });

  it("el archivo borrado del disco no tumba el PDF", async () => {
    mocks.getQuote.mockResolvedValue(
      quoteFixture([item({ imageStoragePath: "catalog/ya_no_esta.png", imageMimeType: "image/png", imageBytes: 1200 })])
    );
    const pdf = await quotePdf(ORG, "qt_1");
    expect(pdf).not.toBeNull();
    expect(Buffer.from(pdf!.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(countImages(pdf!.bytes)).toBe(0);
  });

  it("una ruta que sale del volumen del negocio no se lee", async () => {
    // Foto válida, pero FUERA de `MEDIA_DIR/{negocio}`: un `..` admitido por la
    // columna nunca puede sacar al PDF del árbol del negocio.
    const outside = await svgToPng(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60">' +
          '<rect width="80" height="60" fill="#1d4ed8"/></svg>'
      )
    );
    writeFileSync(join(root, "ajena.png"), outside!);
    mocks.getQuote.mockResolvedValue(
      quoteFixture([
        item({ imageStoragePath: "../ajena.png", imageMimeType: "image/png", imageBytes: outside!.length }),
      ])
    );
    const pdf = await quotePdf(ORG, "qt_1");
    expect(countImages(pdf!.bytes)).toBe(0);
  });

  it("el presupuesto de bytes se respeta y el resto se imprime igual", async () => {
    const photo = await writePhoto("pimg_6.png");
    // `imageBytes` avisa del tamaño real: 13 MB no caben en los 12 MB de
    // presupuesto, así que ni se abre el archivo.
    mocks.getQuote.mockResolvedValue(
      quoteFixture([item({ ...photo, imageBytes: 13 * 1024 * 1024 })])
    );
    const pdf = await quotePdf(ORG, "qt_1");
    expect(pdf).not.toBeNull();
    expect(countImages(pdf!.bytes)).toBe(0);
    expect(Buffer.from(pdf!.bytes.subarray(0, 5)).toString()).toBe("%PDF-");
  });
});
