import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getQuote } from "./service";
import { getBusinessSettings } from "@/server/business-settings";
import { getBranding } from "@/server/branding";
import { pdfInkOn } from "@/lib/branding";
import { clean, tryLoadLogo, wrapText, money, PAGE_W, PAGE_H, MARGIN, CONTENT_W } from "@/server/documents/pdf";

const DARK = rgb(0.13, 0.13, 0.13);
const GRAY = rgb(0.45, 0.45, 0.45);
const ROW_ALT = rgb(0.96, 0.96, 0.96);
const RED = rgb(0.75, 0.2, 0.2);

/** Hex de la marca (0-255) → tinta pdf-lib (0-1). */
function hexRgb(hex: string) {
  return rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  );
}

export async function quotePdf(organizationId: string, id: string) {
  const quote = await getQuote(organizationId, id);
  if (!quote) return null;

  const [bs, branding] = await Promise.all([
    getBusinessSettings(organizationId),
    getBranding(organizationId),
  ]);

  // Colores configurados en Configuración → Marca (default naranja LUMARK).
  const HEADER_BG = hexRgb(branding.pdfColors.header);
  const ACCENT = hexRgb(branding.pdfColors.accent);
  const ink = pdfInkOn(branding.pdfColors.header);
  const HEADER_INK = rgb(ink.r / 255, ink.g / 255, ink.b / 255);

  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

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

  const companyName = bs.companyName || "LUMARK";

  // ─── HEADER: Company name (left) + COTIZACIÓN title (right) ───
  const logoData = tryLoadLogo(bs.logoUrl, organizationId);
  if (logoData && logoData.mime === "image/png") {
    try {
      const img = await doc.embedPng(logoData.data);
      const maxH = 40;
      const scale = maxH / img.height;
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: MARGIN, y: y - h + 5, width: w, height: h });
      page.drawText(clean(companyName).slice(0, 60), { x: MARGIN, y: y - h - 8, size: 14, font: bold, color: DARK });
    } catch {
      page.drawText(clean(companyName).slice(0, 60), { x: MARGIN, y, size: 18, font: bold, color: DARK });
    }
  } else if (logoData && (logoData.mime === "image/jpeg" || logoData.mime === "image/jpg")) {
    try {
      const img = await doc.embedJpg(logoData.data);
      const maxH = 40;
      const scale = maxH / img.height;
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: MARGIN, y: y - h + 5, width: w, height: h });
      page.drawText(clean(companyName).slice(0, 60), { x: MARGIN, y: y - h - 8, size: 14, font: bold, color: DARK });
    } catch {
      page.drawText(clean(companyName).slice(0, 60), { x: MARGIN, y, size: 18, font: bold, color: DARK });
    }
  } else {
    page.drawText(clean(companyName).slice(0, 60), { x: MARGIN, y, size: 18, font: bold, color: DARK });
  }

  // "COTIZACIÓN" title on the right
  page.drawText("COTIZACIÓN", { x: PAGE_W - MARGIN - 120, y, size: 16, font: bold, color: DARK });
  y -= 18;

  // Quote info on the right
  const dateStr = quote.createdAt.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  page.drawText(`N° ${quote.quoteNumber}`, { x: PAGE_W - MARGIN - 120, y, size: 9, font: regular, color: GRAY });
  y -= 13;
  page.drawText(`Fecha: ${dateStr}`, { x: PAGE_W - MARGIN - 120, y, size: 9, font: regular, color: GRAY });
  y -= 13;
  if (quote.validUntil) {
    const validStr = quote.validUntil.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
    page.drawText(`Vigencia: ${validStr}`, { x: PAGE_W - MARGIN - 120, y, size: 9, font: regular, color: GRAY });
  }
  y -= 24;

  // ─── TWO COLUMN: COTIZADO PARA | CONDICIONES DE PAGO ───
  checkPage(60);
  const leftCol = MARGIN;
  const rightCol = MARGIN + CONTENT_W / 2 + 20;

  // Left: COTIZADO PARA
  page.drawText("COTIZADO PARA", { x: leftCol, y, size: 9, font: bold, color: DARK });
  y -= 16;
  if (quote.contactName) {
    page.drawText(clean(quote.contactName), { x: leftCol, y, size: 10, font: bold, color: DARK });
    y -= 14;
  }
  // Contact phone and email from ficha or contact record
  const contactPhone = quote.contactPhone ?? "";
  const contactEmail = quote.contactEmail ?? "";
  if (contactEmail) {
    page.drawText(clean(contactEmail), { x: leftCol, y, size: 9, font: regular, color: GRAY });
    y -= 13;
  }
  if (contactPhone) {
    page.drawText(clean(contactPhone), { x: leftCol, y, size: 9, font: regular, color: GRAY });
    y -= 13;
  }

  // Right: CONDICIONES DE PAGO
  const paymentMethod = quote.paymentMethod as Record<string, unknown> | null;
  const paymentText = paymentMethod?.conditions
    ? String(paymentMethod.conditions)
    : paymentMethod?.text
      ? String(paymentMethod.text)
      : null;

  page.drawText("CONDICIONES DE PAGO", { x: rightCol, y: y + 16, size: 9, font: bold, color: DARK });
  if (paymentText) {
    const payLines = wrapText(paymentText, regular, 9, CONTENT_W / 2 - 20);
    let payY = y;
    for (const line of payLines) {
      page.drawText(clean(line), { x: rightCol, y: payY, size: 9, font: regular, color: GRAY });
      payY -= 13;
    }
  } else {
    page.drawText("Sin condiciones especificadas", { x: rightCol, y, size: 9, font: regular, color: GRAY });
  }

  y -= 30;

  // ─── ITEMS TABLE (dark header) ───
  const colDesc = MARGIN;
  const colQty = MARGIN + 340;
  const colUnit = MARGIN + 400;
  const colTotal = MARGIN + 470;

  // Dark header row
  const headerH = 22;
  page.drawRectangle({
    x: MARGIN,
    y: y - 4,
    width: CONTENT_W,
    height: headerH,
    color: HEADER_BG,
  });

  const headerY = y + 2;
  page.drawText("Descripción", { x: colDesc + 8, y: headerY, size: 9, font: bold, color: HEADER_INK });
  page.drawText("Cantidad", { x: colQty, y: headerY, size: 9, font: bold, color: HEADER_INK });
  page.drawText("P. Unit.", { x: colUnit, y: headerY, size: 9, font: bold, color: HEADER_INK });
  page.drawText("Total", { x: colTotal, y: headerY, size: 9, font: bold, color: HEADER_INK });

  y -= headerH + 4;

  // Table rows
  for (let i = 0; i < quote.items.length; i++) {
    const item = quote.items[i]!;
    const amount = item.quantity * item.unitPrice;
    // Tipografía por jerarquía: el nombre manda (11, negrita), la descripción
    // corta sigue a 9 y la descripción larga del catálogo cierra en 8 gris —
    // era el texto que más rápido se perdía en la página.
    const nameLines = wrapText(item.name, bold, 11, CONTENT_W - 180);
    const descLines = item.description
      ? wrapText(item.description, regular, 9, CONTENT_W - 180)
      : [];
    const longLines = item.longDescription
      ? wrapText(item.longDescription, regular, 8, CONTENT_W - 180)
      : [];
    const rowH = Math.max(
      nameLines.length * 14 + descLines.length * 12 + longLines.length * 10 + 12,
      30
    );

    checkPage(rowH + 10);

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

    // Nombre (grande) → descripción → descripción larga (pequeña)
    let textY = y;
    for (const line of nameLines) {
      page.drawText(clean(line), { x: colDesc + 8, y: textY, size: 11, font: bold, color: DARK });
      textY -= 14;
    }
    for (const line of descLines) {
      page.drawText(clean(line), { x: colDesc + 8, y: textY, size: 9, font: regular, color: DARK });
      textY -= 12;
    }
    for (const line of longLines) {
      page.drawText(clean(line), { x: colDesc + 8, y: textY, size: 8, font: regular, color: GRAY });
      textY -= 10;
    }

    // Qty, Unit price, Total — alineados al renglón del nombre
    page.drawText(String(item.quantity), { x: colQty + 8, y, size: 10, font: regular, color: DARK });
    page.drawText(money(item.unitPrice), { x: colUnit - 10, y, size: 10, font: regular, color: DARK });
    page.drawText(money(amount), { x: colTotal - 20, y, size: 10, font: bold, color: DARK });

    y -= rowH;
  }

  y -= 10;

  // ─── TOTALS (right-aligned, dark box for total) ───
  const totalsLabelX = MARGIN + 340;
  const totalsValueX = MARGIN + 450;

  checkPage(110);

  // Subtotal
  page.drawText("SUBTOTAL:", { x: totalsLabelX, y, size: 10, font: bold, color: DARK });
  page.drawText(money(quote.subtotal), { x: totalsValueX, y, size: 10, font: bold, color: DARK });
  y -= 20;

  // Discount (only if > 0)
  if (quote.discountAmount > 0) {
    const discountPct = quote.discountValue ?? 0;
    const label = quote.discountType === "percentage" ? `DESCUENTO ${discountPct}%:` : "DESCUENTO:";
    page.drawText(label, { x: totalsLabelX, y, size: 10, font: bold, color: RED });
    page.drawText(`-${money(quote.discountAmount)}`, { x: totalsValueX, y, size: 10, font: bold, color: RED });
    y -= 20;
  }

  page.drawText(`IVA (${quote.taxRate}%):`, { x: totalsLabelX, y, size: 10, font: bold, color: DARK });
  page.drawText(money(quote.taxAmount), { x: totalsValueX, y, size: 10, font: bold, color: DARK });
  y -= 20;

  // Total (dark background box)
  y -= 4;
  const totalBoxH = 26;
  page.drawRectangle({
    x: totalsLabelX - 8,
    y: y - totalBoxH + 14,
    width: PAGE_W - MARGIN - totalsLabelX + 16,
    height: totalBoxH,
    color: HEADER_BG,
  });
  page.drawText("TOTAL:", { x: totalsLabelX, y: y - 4, size: 11, font: bold, color: HEADER_INK });
  page.drawText(money(quote.total), { x: totalsValueX, y: y - 4, size: 11, font: bold, color: HEADER_INK });
  y -= totalBoxH + 10;

  // ─── NOTES AND TERMS ───
  if (quote.message) {
    checkPage(50);
    y -= 10;
    page.drawText("NOTAS Y TÉRMINOS", { x: MARGIN, y, size: 10, font: bold, color: DARK });
    y -= 16;
    const noteLines = wrapText(quote.message, regular, 9, CONTENT_W);
    for (const line of noteLines) {
      page.drawText(clean(line), { x: MARGIN, y, size: 9, font: regular, color: GRAY });
      y -= 13;
    }
  }

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
      p.drawText(clean(parts.join("   |   ")).slice(0, 120), {
        x: MARGIN,
        y: footerY,
        size: 8,
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
