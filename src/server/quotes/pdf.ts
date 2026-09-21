import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { getQuote } from "./service";
import { getBusinessSettings } from "@/server/business-settings";
import { money } from "@/server/documents/pdf";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const GOLD = rgb(0.72, 0.59, 0.24);
const DARK = rgb(0.13, 0.13, 0.13);
const GRAY = rgb(0.45, 0.45, 0.45);
const LIGHT_GRAY = rgb(0.88, 0.88, 0.88);

function clean(s: string): string {
  return s.replace(/[\r\n\t]/g, " ").replace(/[^\u0020-\u00ff]/g, "?");
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export async function quotePdf(organizationId: string, id: string) {
  const quote = await getQuote(organizationId, id);
  if (!quote) return null;

  const bs = await getBusinessSettings(organizationId);

  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  doc.setTitle(`Cotización ${quote.quoteNumber}`);
  doc.setAuthor(bs.companyName || "LUMARK");

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const checkPage = (needed: number) => {
    if (y - needed < MARGIN + 40) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  // ─── HEADER: Company name + gold line ───
  const companyName = bs.companyName || "LUMARK";
  page.drawText(clean(companyName).slice(0, 60), { x: MARGIN, y, size: 20, font: bold, color: GOLD });
  y -= 22;

  // Company details (small text under name)
  const details: string[] = [];
  if (bs.rfc) details.push(`RFC: ${bs.rfc}`);
  if (bs.phone) details.push(`Tel: ${bs.phone}`);
  if (bs.email) details.push(bs.email);
  if (details.length) {
    page.drawText(clean(details.join("  |  ")).slice(0, 100), { x: MARGIN, y, size: 9, font: regular, color: GRAY });
    y -= 14;
  }
  if (bs.address) {
    page.drawText(clean(bs.address).slice(0, 100), { x: MARGIN, y, size: 9, font: regular, color: GRAY });
    y -= 14;
  }

  // Gold separator
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: GOLD, thickness: 1.5 });
  y -= 20;

  // ─── QUOTE TITLE ───
  page.drawText("COTIZACIÓN", { x: MARGIN, y, size: 16, font: bold, color: DARK });
  y -= 24;

  // ─── QUOTE INFO + CLIENT INFO (two columns) ───
  const leftX = MARGIN;
  const rightX = MARGIN + CONTENT_W / 2 + 20;

  // Left column: quote details
  const quoteInfo: Array<[string, string]> = [
    ["Folio:", quote.quoteNumber],
    ["Fecha:", quote.createdAt.toLocaleDateString("es-MX")],
    ["Vigencia:", quote.validUntil ? `Hasta ${quote.validUntil.toLocaleDateString("es-MX")}` : "Sin fecha"],
    ["Moneda:", quote.currency],
  ];
  let infoY = y;
  for (const [label, value] of quoteInfo) {
    page.drawText(clean(label), { x: leftX, y: infoY, size: 9, font: bold, color: GRAY });
    page.drawText(clean(value), { x: leftX + 65, y: infoY, size: 9, font: regular, color: DARK });
    infoY -= 14;
  }

  // Right column: client details
  const clientInfo: Array<[string, string]> = [
    ["Cliente:", quote.contactName ?? "Sin contacto"],
    ["Estatus:", quote.status.toUpperCase()],
  ];
  infoY = y;
  for (const [label, value] of clientInfo) {
    page.drawText(clean(label), { x: rightX, y: infoY, size: 9, font: bold, color: GRAY });
    page.drawText(clean(value), { x: rightX + 58, y: infoY, size: 9, font: regular, color: DARK });
    infoY -= 14;
  }

  y = Math.min(y, infoY) - 20;

  // ─── ITEMS TABLE ───
  const colNo = MARGIN;
  const colDesc = MARGIN + 30;
  const colQty = MARGIN + 310;
  const colUnit = MARGIN + 365;
  const colAmount = MARGIN + 440;

  // Table header background
  const headerH = 20;
  page.drawRectangle({
    x: MARGIN,
    y: y - 4,
    width: CONTENT_W,
    height: headerH,
    color: rgb(0.95, 0.93, 0.88),
  });

  const headerY = y + 2;
  page.drawText("#", { x: colNo, y: headerY, size: 8, font: bold, color: GRAY });
  page.drawText("CONCEPTO", { x: colDesc, y: headerY, size: 8, font: bold, color: GRAY });
  page.drawText("CANT.", { x: colQty, y: headerY, size: 8, font: bold, color: GRAY });
  page.drawText("P. UNIT.", { x: colUnit, y: headerY, size: 8, font: bold, color: GRAY });
  page.drawText("IMPORTE", { x: colAmount, y: headerY, size: 8, font: bold, color: GRAY });

  y -= headerH + 4;

  // Table rows
  for (let i = 0; i < quote.items.length; i++) {
    const item = quote.items[i]!;
    const amount = item.quantity * item.unitPrice;
    const rowText = item.description
      ? wrapText(`${item.name} — ${item.description}`, regular, 9, CONTENT_W - 100)
      : wrapText(item.name, regular, 9, CONTENT_W - 100);
    const rowH = Math.max(rowText.length * 12 + 8, 24);

    checkPage(rowH + 10);

    // Alternating row background
    if (i % 2 === 0) {
      page.drawRectangle({
        x: MARGIN,
        y: y - rowH + 14,
        width: CONTENT_W,
        height: rowH,
        color: rgb(0.97, 0.97, 0.97),
      });
    }

    // Row border
    page.drawLine({
      start: { x: MARGIN, y: y - rowH + 10 },
      end: { x: PAGE_W - MARGIN, y: y - rowH + 10 },
      color: LIGHT_GRAY,
      thickness: 0.5,
    });

    // Row number
    page.drawText(String(i + 1), { x: colNo, y, size: 9, font: regular, color: GRAY });

    // Row text (may wrap)
    let textY = y;
    for (const line of rowText) {
      page.drawText(clean(line), { x: colDesc, y: textY, size: 9, font: regular, color: DARK });
      textY -= 12;
    }

    // Qty, unit price, amount (right-aligned)
    page.drawText(String(item.quantity), { x: colQty, y, size: 9, font: regular, color: DARK });
    page.drawText(money(item.unitPrice), { x: colUnit, y, size: 9, font: regular, color: DARK });
    page.drawText(money(amount), { x: colAmount, y, size: 9, font: bold, color: DARK });

    y -= rowH;
  }

  // Bottom border of table
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, color: GOLD, thickness: 1 });
  y -= 20;

  // ─── TOTALS (right-aligned block) ───
  const totalsX = MARGIN + 340;
  const totalsLabelX = MARGIN + 400;
  const totalsValueX = MARGIN + 470;

  checkPage(80);

  const totals: Array<{ label: string; value: string; bold?: boolean; color?: typeof DARK }> = [
    { label: "Subtotal:", value: money(quote.subtotal) },
  ];
  if (quote.discountAmount > 0) {
    totals.push({ label: "Descuento:", value: `-${money(quote.discountAmount)}`, color: rgb(0.8, 0.2, 0.2) });
  }
  totals.push({ label: `IVA (${quote.taxRate}%):`, value: money(quote.taxAmount) });
  totals.push({ label: "TOTAL:", value: money(quote.total), bold: true, color: GOLD });

  // Totals box
  const totalsBoxH = totals.length * 16 + 16;
  page.drawRectangle({
    x: totalsX,
    y: y - totalsBoxH + 14,
    width: PAGE_W - MARGIN - totalsX,
    height: totalsBoxH,
    color: rgb(0.97, 0.96, 0.93),
    borderColor: GOLD,
    borderWidth: 0.5,
  });

  let ty = y;
  for (const t of totals) {
    const font = t.bold ? bold : regular;
    const color = t.color ?? DARK;
    page.drawText(clean(t.label), { x: totalsLabelX, y: ty, size: 9, font, color: GRAY });
    page.drawText(clean(t.value), { x: totalsValueX, y: ty, size: 9, font, color });
    ty -= 16;
  }

  y -= totalsBoxH + 20;

  // ─── PAYMENT CONDITIONS ───
  const paymentMethod = quote.paymentMethod as Record<string, unknown> | null;
  const paymentText = paymentMethod?.conditions
    ? String(paymentMethod.conditions)
    : paymentMethod?.text
      ? String(paymentMethod.text)
      : null;

  if (paymentText) {
    checkPage(40);
    page.drawText("CONDICIONES DE PAGO", { x: MARGIN, y, size: 10, font: bold, color: GOLD });
    y -= 16;
    const payLines = wrapText(paymentText, regular, 9, CONTENT_W);
    for (const line of payLines) {
      page.drawText(clean(line), { x: MARGIN, y, size: 9, font: regular, color: DARK });
      y -= 13;
    }
    y -= 10;
  }

  // ─── NOTES ───
  if (quote.message) {
    checkPage(40);
    page.drawText("NOTAS", { x: MARGIN, y, size: 10, font: bold, color: GOLD });
    y -= 16;
    const noteLines = wrapText(quote.message, regular, 9, CONTENT_W);
    for (const line of noteLines) {
      page.drawText(clean(line), { x: MARGIN, y, size: 9, font: regular, color: DARK });
      y -= 13;
    }
    y -= 10;
  }

  // ─── SIGNATURE LINE ───
  checkPage(70);
  y -= 10;
  page.drawText("Firma del cliente", { x: MARGIN + 80, y, size: 9, font: italic, color: GRAY });
  y -= 4;
  page.drawLine({ start: { x: MARGIN + 20, y }, end: { x: MARGIN + 200, y }, color: GRAY, thickness: 0.8 });
  y -= 14;
  page.drawText("Nombre y fecha", { x: MARGIN + 80, y, size: 8, font: italic, color: GRAY });

  // ─── FOOTER ───
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    p.drawLine({ start: { x: MARGIN, y: 40 }, end: { x: PAGE_W - MARGIN, y: 40 }, color: GOLD, thickness: 0.5 });
    p.drawText(`${companyName} | ${quote.quoteNumber} | Página ${i + 1} de ${pages.length}`, {
      x: MARGIN,
      y: 28,
      size: 8,
      font: regular,
      color: GRAY,
    });
    p.drawText("Este documento no es un comprobante fiscal.", {
      x: MARGIN,
      y: 18,
      size: 7,
      font: italic,
      color: GRAY,
    });
  }

  return { bytes: await doc.save(), filename: `${quote.quoteNumber}.pdf` };
}
