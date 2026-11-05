import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import { getQuote } from "./service";
import { getBusinessSettings } from "@/server/business-settings";
import { getBranding } from "@/server/branding";
import { pdfInkOn } from "@/lib/branding";
import { resolveMediaFile } from "@/server/media-path";
import { clean, tryLoadLogo, wrapText, fitText, money, PAGE_W, PAGE_H, MARGIN, CONTENT_W } from "@/server/documents/pdf";

const DARK = rgb(0.13, 0.13, 0.13);
const GRAY = rgb(0.45, 0.45, 0.45);
const ROW_ALT = rgb(0.96, 0.96, 0.96);
const RED = rgb(0.75, 0.2, 0.2);

/**
 * Geometría de la tabla de partidas: bordes de cada columna. Los importes se
 * alinean al borde derecho de su columna y se encogen (`fitText`) antes de
 * tocarlo, así que con muchos dígitos no sobresalen de la banda naranja ni de
 * la página. Los anchos dejan hueco suficiente entre columna y columna para
 * que el encogimiento nunca monte una cifra sobre la anterior.
 */
export const QUOTE_COLS = {
  descX: MARGIN + 8,
  descW: 250,
  qtyRight: MARGIN + 300,
  unitRight: MARGIN + 400,
  // 8pt de aire dentro de la banda de color: el importe no queda pegado al borde.
  totalRight: PAGE_W - MARGIN - 8,
} as const;

/** Hex de la marca (0-255) → tinta pdf-lib (0-1). */
function hexRgb(hex: string) {
  return rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  );
}

/** Caja de la miniatura: 46 pt ≈ 16 mm, legible en pantalla sin empujar importes. */
const PHOTO_BOX = 46;
/** Aire entre la miniatura y el texto de la partida. */
const PHOTO_GAP = 10;
const PHOTO_COL = PHOTO_BOX + PHOTO_GAP;
/**
 * Presupuesto de imagen de un PDF.
 *
 * En este árbol no hay reescalonado de fotos (sin `sharp`), así que el archivo
 * entra con sus bytes originales y el tamaño del PDF es el tamaño del archivo.
 * Veintitantas partidas de 5 MB reventarían la memoria del hosting compartido;
 * lo que no cabe dentro del presupuesto se omite y la partida se imprime solo
 * con su texto.
 */
const IMAGE_BUDGET = 12 * 1024 * 1024;

type Cover = { image: PDFImage; width: number; height: number };

/**
 * Foto congelada de la partida → imagen lista para dibujar.
 *
 * `null` en todo lo que hace que una partida salga sin foto: sin ruta, formato
 * que pdf-lib no admite (webp y gif sí se suben al catálogo), archivo ilegible o
 * presupuesto agotado. Nunca lanza: una cotización que no se puede descargar es
 * peor que una miniatura que falta.
 *
 * La ruta se resuelve con `resolveMediaFile`, que es la única que contiene el
 * archivo dentro de `MEDIA_DIR/{negocio}`; `imageBytes` es el aviso para no leer
 * discos enormes que de todos modos no caben.
 */
async function embedCover(
  doc: PDFDocument,
  cache: Map<string, Cover | null>,
  used: { bytes: number },
  organizationId: string,
  item: { imageStoragePath: string | null; imageMimeType: string | null; imageBytes: number | null }
): Promise<Cover | null> {
  const path = item.imageStoragePath;
  const png = item.imageMimeType === "image/png";
  const jpg = item.imageMimeType === "image/jpeg" || item.imageMimeType === "image/jpg";
  if (!path || (!png && !jpg)) return null;
  const cached = cache.get(path);
  if (cached !== undefined) return cached;

  let cover: Cover | null = null;
  if (!item.imageBytes || used.bytes + item.imageBytes <= IMAGE_BUDGET) {
    const filePath = resolveMediaFile(organizationId, ...path.split("/"));
    if (filePath) {
      try {
        const data = readFileSync(filePath);
        if (used.bytes + data.length <= IMAGE_BUDGET) {
          used.bytes += data.length;
          const image = png ? await doc.embedPng(data) : await doc.embedJpg(data);
          cover = { image, width: image.width, height: image.height };
        }
      } catch {
        cover = null;
      }
    }
  }
  cache.set(path, cover);
  return cover;
}

export async function quotePdf(organizationId: string, id: string) {
  const quote = await getQuote(organizationId, id);
  if (!quote) return null;

  const [bs, branding] = await Promise.all([
    getBusinessSettings(organizationId),
    getBranding(organizationId),
  ]);

  // Colores configurados en Configuración → Marca (default naranja Zorro Tech).
  const HEADER_BG = hexRgb(branding.pdfColors.header);
  const ACCENT = hexRgb(branding.pdfColors.accent);
  const ink = pdfInkOn(branding.pdfColors.header);
  const HEADER_INK = rgb(ink.r / 255, ink.g / 255, ink.b / 255);

  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  doc.setTitle(`Cotización ${quote.quoteNumber}`);
  doc.setAuthor(bs.companyName || "Zorro Tech");

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  /** Salta de página si `needed` no cabe; devuelve true si saltó. */
  const checkPage = (needed: number) => {
    if (y - needed < MARGIN + 40) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      return true;
    }
    return false;
  };

  const companyName = bs.companyName || "Zorro Tech";

  // El nombre no debe invadir la columna derecha (N°/fecha/vigencia): se mide
  // contra el hueco real y, si no cabe, se encoge en vez de pisar o salirse.
  const companyMaxW = 280;
  const drawCompany = (yPos: number, size: number) => {
    const fitted = fitText(bold, clean(companyName), size, companyMaxW);
    page.drawText(fitted.text, { x: MARGIN, y: yPos, size: fitted.size, font: bold, color: DARK });
  };

  // N°/fecha/vigencia van alineados al margen derecho: con una fecha larga la
  // columna fija en x se salía de la página.
  const infoRight = PAGE_W - MARGIN;
  const infoMaxW = infoRight - (MARGIN + companyMaxW + 15);
  const drawInfo = (text: string, yPos: number, font: PDFFont, size: number, color: typeof DARK) => {
    const fitted = fitText(font, clean(text), size, infoMaxW);
    const w = font.widthOfTextAtSize(fitted.text, fitted.size);
    page.drawText(fitted.text, { x: infoRight - w, y: yPos, size: fitted.size, font, color });
  };

  // ─── HEADER: Company name (left) + COTIZACIÓN title (right) ───
  const logoData = await tryLoadLogo(bs.logoUrl, organizationId);
  if (logoData && logoData.mime === "image/png") {
    try {
      const img = await doc.embedPng(logoData.data);
      const maxH = 40;
      const scale = maxH / img.height;
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: MARGIN, y: y - h + 5, width: w, height: h });
      drawCompany(y - h - 8, 14);
    } catch {
      drawCompany(y, 18);
    }
  } else if (logoData && (logoData.mime === "image/jpeg" || logoData.mime === "image/jpg")) {
    try {
      const img = await doc.embedJpg(logoData.data);
      const maxH = 40;
      const scale = maxH / img.height;
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: MARGIN, y: y - h + 5, width: w, height: h });
      drawCompany(y - h - 8, 14);
    } catch {
      drawCompany(y, 18);
    }
  } else {
    drawCompany(y, 18);
  }

  // "COTIZACIÓN" title on the right
  drawInfo("COTIZACIÓN", y, bold, 16, DARK);
  y -= 18;

  // Quote info on the right
  const dateStr = quote.createdAt.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  drawInfo(`N° ${quote.quoteNumber}`, y, regular, 9, GRAY);
  y -= 13;
  drawInfo(`Fecha: ${dateStr}`, y, regular, 9, GRAY);
  y -= 13;
  if (quote.validUntil) {
    const validStr = quote.validUntil.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    drawInfo(`Vigencia: ${validStr}`, y, regular, 9, GRAY);
  }
  y -= 24;

  // ─── TWO COLUMN: COTIZADO PARA | NOTAS ───
  const leftCol = MARGIN;
  const rightCol = MARGIN + CONTENT_W / 2 + 20;
  const colW = CONTENT_W / 2 - 20;

  const paymentMethod = quote.paymentMethod as Record<string, unknown> | null;
  const paymentText = paymentMethod?.conditions
    ? String(paymentMethod.conditions)
    : paymentMethod?.text
      ? String(paymentMethod.text)
      : null;

  type PdfLine = { text: string; font: PDFFont; size: number; color: typeof DARK; h: number };
  const wrapInto = (out: PdfLine[], raw: string, font: PDFFont, size: number, color: typeof DARK, h: number) => {
    for (const line of wrapText(clean(raw), font, size, colW)) out.push({ text: line, font, size, color, h });
  };

  const leftLines: PdfLine[] = [{ text: "COTIZADO PARA", font: bold, size: 9, color: DARK, h: 17 }];
  if (quote.contactName) wrapInto(leftLines, quote.contactName, bold, 10, DARK, 14);
  if (quote.contactEmail) wrapInto(leftLines, quote.contactEmail, regular, 9, GRAY, 13);
  if (quote.contactPhone) wrapInto(leftLines, quote.contactPhone, regular, 9, GRAY, 13);
  // Igual que NOTAS con «Sin notas»: una etiqueta sola en el PDF es el bloque
  // vacío que el dueño reportó en COT-0004.
  if (leftLines.length === 1) {
    leftLines.push({ text: "Sin contacto asignado", font: regular, size: 9, color: GRAY, h: 13 });
  }

  // Una sola caja de Notas: la que escribe el operador en el diálogo y, encima,
  // las condiciones de pago que ya venían guardadas en una cotización vieja.
  // Abajo del todo ya no se repite: era el mismo texto en dos sitios.
  const rightLines: PdfLine[] = [{ text: "NOTAS", font: bold, size: 9, color: DARK, h: 17 }];
  const notas = [quote.message?.trim(), paymentText?.trim()].filter(
    (block): block is string => Boolean(block)
  );
  for (const block of notas) {
    for (const paragraph of block.split(/\r?\n/)) {
      if (paragraph.trim()) wrapInto(rightLines, paragraph, regular, 9, GRAY, 13);
    }
  }
  if (notas.length === 0) {
    rightLines.push({ text: "Sin notas", font: regular, size: 9, color: GRAY, h: 13 });
  }

  // Las dos columnas comparten línea base: cada renglón baja `y` la altura
  // máxima de ambas y salta de página si no cabe. Antes el bloque no movía `y`
  // (y ni siquiera alineaba sus etiquetas): las condiciones largas se comían
  // la tabla y se cortaban contra el pie de la página.
  for (let i = 0; i < Math.max(leftLines.length, rightLines.length); i++) {
    const left = leftLines[i];
    const right = rightLines[i];
    const h = Math.max(left?.h ?? 13, right?.h ?? 13);
    checkPage(h);
    if (left) page.drawText(left.text, { x: leftCol, y, size: left.size, font: left.font, color: left.color });
    if (right) page.drawText(right.text, { x: rightCol, y, size: right.size, font: right.font, color: right.color });
    y -= h;
  }

  y -= 10;

  // ─── ITEMS TABLE (dark header) ───
  // Las miniaturas se cargan ANTES de dibujar la cabecera: si ninguna partida
  // tiene foto, la columna no existe y la descripción ocupa todo el ancho de
  // siempre. Con foto, la caja se recorta por la izquierda y su borde derecho
  // sigue cayendo en el mismo punto, así que las columnas de importes no se
  // mueven.
  const coverCache = new Map<string, Cover | null>();
  const usedBytes = { bytes: 0 };
  const covers: (Cover | null)[] = [];
  for (const item of quote.items) {
    covers.push(await embedCover(doc, coverCache, usedBytes, organizationId, item));
  }
  const photoCol = covers.some(Boolean) ? PHOTO_COL : 0;
  const descX = QUOTE_COLS.descX + photoCol;
  const descW = QUOTE_COLS.descW - photoCol;

  const headerH = 22;

  /** Escribe `text` alineado al borde derecho de su columna, encogiéndolo. */
  const cell = (text: string, right: number, maxWidth: number, size: number, font: PDFFont, color: typeof DARK) => {
    const fitted = fitText(font, clean(text), size, maxWidth);
    const w = font.widthOfTextAtSize(fitted.text, fitted.size);
    page.drawText(fitted.text, { x: Math.max(MARGIN, right - w), y, size: fitted.size, font, color });
  };

  const drawHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: headerH, color: HEADER_BG });
    const hy = y + 2;
    const label = (text: string, right: number) => {
      page.drawText(text, { x: right - bold.widthOfTextAtSize(text, 9), y: hy, size: 9, font: bold, color: HEADER_INK });
    };
    page.drawText("Descripción", { x: descX, y: hy, size: 9, font: bold, color: HEADER_INK });
    label("Cantidad", QUOTE_COLS.qtyRight);
    label("P. Unit.", QUOTE_COLS.unitRight);
    label("Total", QUOTE_COLS.totalRight);
    y -= headerH + 4;
  };

  checkPage(headerH + 40);
  drawHeader();

  // Table rows
  for (let i = 0; i < quote.items.length; i++) {
    const item = quote.items[i]!;
    const cover = covers[i] ?? null;
    const amount = item.quantity * item.unitPrice;
    // Tipografía por jerarquía: el nombre manda (11, negrita), la descripción
    // corta sigue a 9 y la descripción larga del catálogo cierra en 8 gris —
    // era el texto que más rápido se perdía en la página.
    const nameLines = wrapText(clean(item.name), bold, 11, descW);
    const descLines = item.description
      ? wrapText(clean(item.description), regular, 9, descW)
      : [];
    const longLines = item.longDescription
      ? wrapText(clean(item.longDescription), regular, 8, descW)
      : [];
    const rowH = Math.max(
      nameLines.length * 14 + descLines.length * 12 + longLines.length * 10 + 12,
      // Con miniatura la fila tiene que dar su alto: si no, la foto se montaba
      // sobre la partida de abajo.
      cover ? PHOTO_BOX + 6 : 30
    );

    // Si la fila salta de página, la cabecera de la tabla viaja con ella.
    if (checkPage(rowH + 10)) drawHeader();

    // Alternating row
    if (i % 2 === 0) {
      page.drawRectangle({
        x: MARGIN,
        y: y - rowH + 12,
        width: CONTENT_W,
        height: rowH,
        color: ROW_ALT,
      });
    }

    // Miniatura: arriba de la fila, centrada en su columna, escalada a la caja.
    if (cover) {
      const scale = Math.min(PHOTO_BOX / cover.width, PHOTO_BOX / cover.height);
      const w = cover.width * scale;
      const h = cover.height * scale;
      page.drawImage(cover.image, {
        x: MARGIN + 8 + (PHOTO_BOX - w) / 2,
        y: y + 3 - h,
        width: w,
        height: h,
      });
    }

    // Nombre (grande) → descripción → descripción larga (pequeña)
    let textY = y;
    for (const line of nameLines) {
      page.drawText(line, { x: descX, y: textY, size: 11, font: bold, color: DARK });
      textY -= 14;
    }
    for (const line of descLines) {
      page.drawText(line, { x: descX, y: textY, size: 9, font: regular, color: DARK });
      textY -= 12;
    }
    for (const line of longLines) {
      page.drawText(line, { x: descX, y: textY, size: 8, font: regular, color: GRAY });
      textY -= 10;
    }

    // Qty, Unit price, Total — alineados a la derecha de su columna
    cell(String(item.quantity), QUOTE_COLS.qtyRight, QUOTE_COLS.qtyRight - (descX + descW) - 8, 10, regular, DARK);
    cell(money(item.unitPrice), QUOTE_COLS.unitRight, QUOTE_COLS.unitRight - QUOTE_COLS.qtyRight - 8, 10, regular, DARK);
    cell(money(amount), QUOTE_COLS.totalRight, QUOTE_COLS.totalRight - QUOTE_COLS.unitRight - 8, 10, bold, DARK);

    y -= rowH;
  }

  y -= 10;

  // ─── TOTALS (right-aligned, dark box for total) ───
  const totalsLabelX = MARGIN + 340;
  // La banda del total sigue llegando al margen; solo el texto se separa 10pt.
  const totalsBandRight = PAGE_W - MARGIN;
  const totalsRight = totalsBandRight - 10;

  checkPage(110);

  const totalsRow = (label: string, value: string, color: typeof DARK, size = 10) => {
    page.drawText(label, { x: totalsLabelX, y, size, font: bold, color });
    const labelW = bold.widthOfTextAtSize(label, size);
    cell(value, totalsRight, totalsRight - totalsLabelX - labelW - 10, size, bold, color);
    y -= 20;
  };

  totalsRow("SUBTOTAL:", money(quote.subtotal), DARK);

  // Discount (only if > 0)
  if (quote.discountAmount > 0) {
    const discountPct = quote.discountValue ?? 0;
    const label = quote.discountType === "percentage" ? `DESCUENTO ${discountPct}%:` : "DESCUENTO:";
    totalsRow(label, `-${money(quote.discountAmount)}`, RED);
  }

  totalsRow(`IVA (${quote.taxRate}%):`, money(quote.taxAmount), DARK);

  // Total (dark background box)
  y -= 4;
  const totalBoxH = 26;
  const boxX = totalsLabelX - 8;
  page.drawRectangle({
    x: boxX,
    y: y - totalBoxH + 14,
    width: totalsBandRight - boxX,
    height: totalBoxH,
    color: HEADER_BG,
  });
  const totalLabel = "TOTAL:";
  page.drawText(totalLabel, { x: totalsLabelX, y: y - 4, size: 11, font: bold, color: HEADER_INK });
  cell(
    money(quote.total),
    totalsRight,
    totalsRight - totalsLabelX - bold.widthOfTextAtSize(totalLabel, 11) - 10,
    11,
    bold,
    HEADER_INK
  );
  y -= totalBoxH + 10;

  // ─── FOOTER (business info + page number) ───
  const pages = doc.getPages();
  const footerY = 30;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    // Footer separator line
    p.drawLine({ start: { x: MARGIN, y: footerY + 12 }, end: { x: PAGE_W - MARGIN, y: footerY + 12 }, color: ACCENT, thickness: 0.75 });

    const parts: string[] = [];
    if (bs.email) parts.push(bs.email);
    if (bs.phone) parts.push(bs.phone);
    if (bs.rfc) parts.push(`RFC: ${bs.rfc}`);
    if (bs.address) parts.push(bs.address);
    if (bs.website) parts.push(bs.website);
    if (parts.length) {
      const footerText = fitText(regular, clean(parts.join("   |   ")), 8, CONTENT_W - 40);
      p.drawText(footerText.text, {
        x: MARGIN,
        y: footerY,
        size: footerText.size,
        font: regular,
        color: GRAY,
      });
    }
    // Page number
    p.drawText(`${i + 1} / ${pages.length}`, {
      x: PAGE_W - MARGIN - 30,
      y: footerY,
      size: 8,
      font: regular,
      color: GRAY,
    });
  }

  return { bytes: await doc.save(), filename: `${quote.quoteNumber}.pdf` };
}
