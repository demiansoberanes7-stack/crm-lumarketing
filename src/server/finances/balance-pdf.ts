import { PDFDocument, StandardFonts, rgb, type RGB } from "pdf-lib";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { financialReport, type reportPeriod } from "./report";
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
const GREEN = rgb(0.15, 0.55, 0.25);
const RED = rgb(0.75, 0.2, 0.2);
const _noop = undefined as unknown as (val: string) => RGB;

const MEDIA_DIR = process.env.MEDIA_DIR ?? "/data/media";

function clean(s: string): string {
  return s.replace(/[\r\n\t]/g, " ").replace(/[^\u0020-\u00ff]/g, "?");
}

function tryLoadLogo(logoUrl: string | undefined, organizationId: string): { data: Uint8Array; mime: string } | null {
  if (!logoUrl) return null;
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

export async function balancePdf(organizationId: string, period: { from: Date; to: Date }) {
  const report = await financialReport(organizationId, period);
  const bs = await getBusinessSettings(organizationId);
  const from = period.from.toISOString().slice(0, 10);
  const to = period.to.toISOString().slice(0, 10);

  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  doc.setTitle(`Balance ${from} a ${to}`);
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
    } catch { /* fall through */ }
  } else if (logoData && logoData.mime === "image/jpeg") {
    try {
      const img = await doc.embedJpg(logoData.data);
      const maxH = 50;
      const scale = maxH / img.height;
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: MARGIN, y: y - h + 10, width: w, height: h });
    } catch { /* fall through */ }
  } else {
    page.drawText(clean(companyName).slice(0, 60), { x: MARGIN, y, size: 22, font: bold, color: DARK });
  }

  // Date on the right
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  page.drawText(clean(dateStr), { x: PAGE_W - MARGIN - 150, y, size: 11, font: regular, color: GRAY });

  y -= 30;

  // ─── TITLE ───
  page.drawText("BALANCE GENERAL", { x: MARGIN, y, size: 14, font: bold, color: DARK });
  y -= 16;
  page.drawText(`Periodo: ${from} al ${to}`, { x: MARGIN, y, size: 10, font: regular, color: GRAY });
  y -= 30;

  // ─── SUMMARY CARDS (3 columns) ───
  checkPage(60);
  const cardW = CONTENT_W / 3;
  const cardH = 50;

  // Card: Ingresos
  page.drawRectangle({ x: MARGIN, y: y - cardH + 10, width: cardW - 8, height: cardH, color: rgb(0.94, 0.98, 0.94) });
  page.drawText("INGRESOS", { x: MARGIN + 12, y, size: 9, font: bold, color: GREEN });
  page.drawText(money(report.balance.ingresos), { x: MARGIN + 12, y: y - 20, size: 14, font: bold, color: GREEN });

  // Card: Egresos
  page.drawRectangle({ x: MARGIN + cardW, y: y - cardH + 10, width: cardW - 8, height: cardH, color: rgb(1, 0.94, 0.94) });
  page.drawText("EGRESOS", { x: MARGIN + cardW + 12, y, size: 9, font: bold, color: RED });
  page.drawText(money(report.balance.egresos), { x: MARGIN + cardW + 12, y: y - 20, size: 14, font: bold, color: RED });

  // Card: Balance
  const balanceColor = report.balance.balance >= 0 ? GREEN : RED;
  const balanceBg = report.balance.balance >= 0 ? rgb(0.94, 0.98, 0.94) : rgb(1, 0.94, 0.94);
  page.drawRectangle({ x: MARGIN + cardW * 2, y: y - cardH + 10, width: cardW - 8, height: cardH, color: balanceBg });
  page.drawText("BALANCE", { x: MARGIN + cardW * 2 + 12, y, size: 9, font: bold, color: balanceColor });
  page.drawText(money(report.balance.balance), { x: MARGIN + cardW * 2 + 12, y: y - 20, size: 14, font: bold, color: balanceColor });

  y -= cardH + 30;

  // ─── TABLE HELPER ───
  function drawTable(
    title: string,
    headers: string[],
    colWidths: number[],
    rows: string[][],
    columnColors?: ((val: string) => RGB | undefined)[] | null,
  ) {
    if (rows.length === 0) return;

    checkPage(40);
    page.drawText(title, { x: MARGIN, y, size: 11, font: bold, color: DARK });
    y -= 20;

    // Header
    page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: 20, color: HEADER_BG });
    let xOff = MARGIN;
    for (let i = 0; i < headers.length; i++) {
      page.drawText(clean(headers[i]!), { x: xOff + 8, y: y + 2, size: 9, font: bold, color: rgb(1, 1, 1) });
      xOff += colWidths[i]!;
    }
    y -= 20;

    // Rows
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      checkPage(18);
      if (r % 2 === 0) {
        page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: 16, color: ROW_ALT });
      }
      xOff = MARGIN;
      for (let c = 0; c < row.length; c++) {
        const val = row[c]!;
        const colorFn = columnColors?.[c] ?? null;
        const color = colorFn ? colorFn(val) : DARK;
        page.drawText(clean(val).slice(0, 60), { x: xOff + 8, y: y, size: 9, font: regular, color });
        xOff += colWidths[c]!;
      }
      y -= 16;
    }
    y -= 16;
  }

  // ─── INGRESOS TABLE ───
  const ingresoRows = report.pagosRecientes.map((p) => [
    p.fecha.toISOString().slice(0, 10),
    money(p.monto),
    p.metodo,
    p.referencia ?? "-",
    p.notas ?? "-",
  ]);
  drawTable(
    "INGRESOS",
    ["Fecha", "Monto", "Método", "Referencia", "Notas"],
    [90, 100, 110, 110, 110],
    ingresoRows,
    [_noop, () => GREEN, _noop, _noop, _noop],
  );

  // ─── EGRESOS TABLE ───
  const egresoRows = report.gastosRecientes.map((g) => [
    g.fecha.toISOString().slice(0, 10),
    money(g.monto),
    g.descripcion,
    g.categoria,
    g.metodo,
  ]);
  drawTable(
    "EGRESOS",
    ["Fecha", "Monto", "Descripción", "Categoría", "Método"],
    [90, 100, 130, 90, 100],
    egresoRows,
    [_noop, () => RED, _noop, _noop, _noop],
  );

  // ─── CUENTAS POR COBRAR TABLE ───
  const cxcRows = report.cuentasPorCobrar.map((c) => [
    c.concept,
    money(c.totalAmount),
    money(c.paidAmount),
    money(c.totalAmount - c.paidAmount),
    c.status === "pagado" ? "Pagado" : "Pendiente",
  ]);
  drawTable(
    "CUENTAS POR COBRAR",
    ["Concepto", "Total", "Pagado", "Pendiente", "Estado"],
    [140, 100, 100, 100, 80],
    cxcRows,
    [_noop, _noop, _noop, (v) => v === "$0.00" ? GREEN : RED, (v) => v === "Pagado" ? GREEN : RED],
  );

  // ─── FOOTER (phone | email | website) + page numbers ───
  const pages = doc.getPages();
  const footerY = 30;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    p.drawLine({ start: { x: MARGIN, y: footerY + 12 }, end: { x: PAGE_W - MARGIN, y: footerY + 12 }, color: LIGHT_GRAY, thickness: 0.5 });
    const parts: string[] = [];
    if (bs.phone) parts.push(bs.phone);
    if (bs.email) parts.push(bs.email);
    if (bs.website) parts.push(bs.website);
    if (parts.length) {
      p.drawText(clean(parts.join("   |   ")).slice(0, 120), { x: MARGIN, y: footerY, size: 8, font: regular, color: GRAY });
    }
    p.drawText(`${i + 1} / ${pages.length}`, { x: PAGE_W - MARGIN - 30, y: footerY, size: 8, font: regular, color: GRAY });
  }

  return { bytes: await doc.save(), filename: `Balance-${from}-${to}.pdf` };
}
