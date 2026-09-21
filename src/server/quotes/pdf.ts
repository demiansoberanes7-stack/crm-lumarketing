import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getQuote } from "./service";
import { getBusinessSettings } from "@/server/business-settings";
import { money } from "@/server/documents/pdf";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const DARK = rgb(0.13, 0.13, 0.13);
const GRAY = rgb(0.45, 0.45, 0.45);
const LIGHT_GRAY = rgb(0.88, 0.88, 0.88);
const HEADER_BG = rgb(0.28, 0.28, 0.28);
const ROW_ALT = rgb(0.96, 0.96, 0.96);
const RED = rgb(0.75, 0.2, 0.2);

const MEDIA_DIR = process.env.MEDIA_DIR ?? "/data/media";

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

function tryLoadLogo(logoUrl: string | undefined, organizationId: string): { data: Uint8Array; mime: string } | null {
  if (!logoUrl) return null;
  // Extract filename from URL path: /api/media/public/{orgId}/{filename}
  const match = logoUrl.match(/\/([^/]+)$/);
  if (!match) return null;
  const filename = match[1]!;
  const filePath = join(MEDIA_DIR, organizationId, filename);
  if (!existsSync(filePath)) return null;
  try {
    const data = readFileSync(filePath);
    const ext = filename.split(".").pop()?.toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "svg" ? "image/svg+xml" : "image/jpeg";
    return { data: new Uint8Array(data), mime };
  } catch {
    return null;
  }
}

export async function quotePdf(organizationId: string, id: string) {
  const quote = await getQuote(organizationId, id);
  if (!quote) return null;

  const bs = await getBusinessSettings(organizationId);

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

  // ─── HEADER: Logo (left) + Date (right) ───
  const logoData = tryLoadLogo(bs.logoUrl, organizationId);
  if (logoData && logoData.mime === "image/png") {
    try {
      const img = await doc.embedPng(logoData.data);
      const maxH = 50;
      const scale = maxH / img.height;
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: MARGIN, y: y - h + 10, width: w, height: h });
    } catch {
      // If PNG fails, fall through to text
    }
  } else if (logoData && (logoData.mime === "image/jpeg" || logoData.mime === "image/jpg")) {
    try {
      const img = await doc.embedJpg(logoData.data);
      const maxH = 50;
      const scale = maxH / img.height;
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: MARGIN, y: y - h + 10, width: w, height: h });
    } catch {
      // Fall through to text
    }
  } else {
    // No logo: draw company name as text
    page.drawText(clean(companyName).slice(0, 60), { x: MARGIN, y, size: 22, font: bold, color: DARK });
  }

  // Date on the right
  const dateStr = quote.createdAt.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  page.drawText(clean(dateStr), { x: PAGE_W - MARGIN - 150, y, size: 11, font: regular, color: GRAY });

  y -= 20;

  // ─── CLIENT INFO ───
  y -= 16;
  if (quote.contactName) {
    page.drawText(clean(quote.contactName), { x: MARGIN, y, size: 12, font: bold, color: DARK });
    y -= 16;
  }
  if (bs.rfc) {
    page.drawText(`RFC: ${clean(bs.rfc)}`, { x: MARGIN, y, size: 9, font: regular, color: GRAY });
    y -= 14;
  }
  if (bs.address) {
    const addrLines = wrapText(bs.address, regular, 9, CONTENT_W / 2);
    for (const line of addrLines) {
      page.drawText(clean(line), { x: MARGIN, y, size: 9, font: regular, color: GRAY });
      y -= 13;
    }
  }
  if (bs.email) {
    page.drawText(clean(bs.email), { x: MARGIN, y, size: 9, font: regular, color: GRAY });
    y -= 14;
  }
  if (bs.phone) {
    page.drawText(clean(bs.phone), { x: MARGIN, y, size: 9, font: regular, color: GRAY });
    y -= 14;
  }

  y -= 20;

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
  page.drawText("Descripción", { x: colDesc + 8, y: headerY, size: 9, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Cantidad", { x: colQty, y: headerY, size: 9, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Und", { x: colUnit, y: headerY, size: 9, font: bold, color: rgb(1, 1, 1) });
  page.drawText("Total", { x: colTotal, y: headerY, size: 9, font: bold, color: rgb(1, 1, 1) });

  y -= headerH + 4;

  // Table rows
  for (let i = 0; i < quote.items.length; i++) {
    const item = quote.items[i]!;
    const amount = item.quantity * item.unitPrice;
    const rowText = item.description
      ? wrapText(`${item.name} — ${item.description}`, regular, 9, CONTENT_W - 180)
      : wrapText(item.name, regular, 9, CONTENT_W - 180);
    const rowH = Math.max(rowText.length * 13 + 10, 28);

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

    // Description (may wrap)
    let textY = y;
    for (const line of rowText) {
      page.drawText(clean(line), { x: colDesc + 8, y: textY, size: 9, font: regular, color: DARK });
      textY -= 13;
    }

    // Qty, Unit, Total
    page.drawText(String(item.quantity), { x: colQty + 8, y, size: 9, font: regular, color: DARK });
    page.drawText(String(item.quantity), { x: colUnit + 8, y, size: 9, font: regular, color: DARK });
    page.drawText(money(amount), { x: colTotal - 20, y, size: 9, font: regular, color: DARK });

    y -= rowH;
  }

  y -= 10;

  // ─── TOTALS (right-aligned, dark box for total) ───
  const totalsLabelX = MARGIN + 340;
  const totalsValueX = MARGIN + 450;

  checkPage(90);

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
  page.drawText("TOTAL:", { x: totalsLabelX, y: y - 4, size: 11, font: bold, color: rgb(1, 1, 1) });
  page.drawText(money(quote.total), { x: totalsValueX, y: y - 4, size: 11, font: bold, color: rgb(1, 1, 1) });
  y -= totalBoxH + 10;

  // ─── NOTE ───
  if (quote.message) {
    checkPage(50);
    y -= 10;
    page.drawText("Nota:", { x: MARGIN, y, size: 10, font: bold, color: DARK });
    y -= 16;
    const noteLines = wrapText(quote.message, regular, 9, CONTENT_W);
    for (const line of noteLines) {
      page.drawText(clean(line), { x: MARGIN, y, size: 9, font: regular, color: GRAY });
      y -= 13;
    }
  }

  // ─── PAYMENT CONDITIONS ───
  const paymentMethod = quote.paymentMethod as Record<string, unknown> | null;
  const paymentText = paymentMethod?.conditions
    ? String(paymentMethod.conditions)
    : paymentMethod?.text
      ? String(paymentMethod.text)
      : null;

  if (paymentText) {
    checkPage(40);
    y -= 10;
    const payLines = wrapText(paymentText, regular, 9, CONTENT_W);
    for (const line of payLines) {
      page.drawText(clean(line), { x: MARGIN, y, size: 9, font: regular, color: GRAY });
      y -= 13;
    }
  }

  // ─── FOOTER (phone | email | website) ───
  const pages = doc.getPages();
  const footerY = 30;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    // Footer separator line
    p.drawLine({ start: { x: MARGIN, y: footerY + 12 }, end: { x: PAGE_W - MARGIN, y: footerY + 12 }, color: LIGHT_GRAY, thickness: 0.5 });

    const parts: string[] = [];
    if (bs.phone) parts.push(bs.phone);
    if (bs.email) parts.push(bs.email);
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
