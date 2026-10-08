import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { CONTENT_W, MARGIN, PAGE_W, fitText, wrapText } from "@/server/documents/pdf";
import { QUOTE_COLS } from "@/server/quotes/pdf";

let regular: PDFFont;
let bold: PDFFont;

beforeAll(async () => {
  const doc = await PDFDocument.create();
  regular = await doc.embedFont(StandardFonts.Helvetica);
  bold = await doc.embedFont(StandardFonts.HelveticaBold);
});

describe("fitText", () => {
  it("deja el tamaño intacto cuando el texto ya cabe", () => {
    const out = fitText(regular, "$39.50", 10, 80);
    expect(out.size).toBe(10);
    expect(out.text).toBe("$39.50");
  });

  it("encoge la cifra hasta que quepa en su columna", () => {
    const amount = "$99,989,999,900.01";
    const maxWidth = QUOTE_COLS.totalRight - QUOTE_COLS.unitRight - 8;
    const out = fitText(bold, amount, 10, maxWidth);

    expect(out.size).toBeLessThan(10);
    expect(bold.widthOfTextAtSize(out.text, out.size)).toBeLessThanOrEqual(maxWidth);
    expect(out.text).toBe(amount); // solo se achica, no se recorta
  });

  it("recorta con '...' si ni siquiera en el tamaño mínimo cabe", () => {
    const huge = "9".repeat(400);
    const out = fitText(regular, huge, 10, 30, 5);

    expect(regular.widthOfTextAtSize(out.text, out.size)).toBeLessThanOrEqual(30);
    expect(out.text.endsWith("...")).toBe(true);
    expect(out.text.length).toBeGreaterThan(1);
  });

  it("nunca devuelve texto vacío ni tamaño por debajo del mínimo", () => {
    const out = fitText(regular, "X".repeat(500), 12, 10, 6);
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.size).toBeGreaterThanOrEqual(6);
  });
});

describe("wrapText", () => {
  it("parte las condiciones de pago en líneas que caben en la columna", () => {
    const condiciones =
      "50% de anticipo y 50% contra entrega, pagadero por transferencia " +
      "bancaria a más tardar quince días naturales después de la recepción.";
    const colW = CONTENT_W / 2 - 20;
    const lines = wrapText(condiciones, regular, 9, colW);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(regular.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(colW);
    }
    expect(lines.join(" ")).toBe(condiciones);
  });
});

describe("geometría de la tabla de cotización", () => {
  it("las columnas caben en la página y dejan hueco entre sí", () => {
    expect(QUOTE_COLS.descX).toBe(MARGIN + 8);
    expect(QUOTE_COLS.descX + QUOTE_COLS.descW).toBeLessThan(QUOTE_COLS.qtyRight - 8);
    expect(QUOTE_COLS.qtyRight).toBeLessThan(QUOTE_COLS.unitRight - 8);
    expect(QUOTE_COLS.unitRight).toBeLessThan(QUOTE_COLS.totalRight - 8);
    expect(QUOTE_COLS.totalRight).toBe(PAGE_W - MARGIN);
  });

  it("un importe gigante cabe en cada columna sin cruzar su borde", () => {
    const gigante = "$999,999,999,999.99";
    const columnas = [
      { right: QUOTE_COLS.qtyRight, maxWidth: QUOTE_COLS.qtyRight - (QUOTE_COLS.descX + QUOTE_COLS.descW) - 8, font: regular },
      { right: QUOTE_COLS.unitRight, maxWidth: QUOTE_COLS.unitRight - QUOTE_COLS.qtyRight - 8, font: regular },
      { right: QUOTE_COLS.totalRight, maxWidth: QUOTE_COLS.totalRight - QUOTE_COLS.unitRight - 8, font: bold },
    ];
    for (const col of columnas) {
      const out = fitText(col.font, gigante, 10, col.maxWidth);
      const width = col.font.widthOfTextAtSize(out.text, out.size);
      expect(width).toBeLessThanOrEqual(col.maxWidth);
      expect(col.right - width).toBeGreaterThanOrEqual(MARGIN);
      expect(col.right).toBeLessThanOrEqual(PAGE_W - MARGIN);
    }
  });
});
