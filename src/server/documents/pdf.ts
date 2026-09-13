import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const money = (cents: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);

/** PDF paginado, sin navegador ni servicios externos. Texto seleccionable. */
export async function reportPdf(title: string, lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(title); doc.setAuthor("LUMARK");
  let page = doc.addPage([595.28, 841.89]);
  let y = 730;
  const clean = (s: string) => s.replace(/[\r\n\t]/g, " ").replace(/[^\u0020-\u00ff]/g, "?");
  const header = () => {
    page.drawText("LUMARK", { x: 42, y: 795, size: 23, font: bold, color: rgb(.72, .59, .24) });
    page.drawText(clean(title).slice(0, 85), { x: 42, y: 765, size: 12, font: bold });
    page.drawLine({ start: { x: 42, y: 750 }, end: { x: 553, y: 750 }, color: rgb(.72, .59, .24), thickness: 1 });
  };
  header();
  const line = (text: string) => {
    if (y < 65) { page = doc.addPage([595.28, 841.89]); y = 730; header(); }
    page.drawText(text, { x: 42, y, size: 10, font: regular }); y -= 16;
  };
  for (const source of lines) {
    for (const paragraph of source.split("\n")) {
      let buffer = "";
      for (const char of clean(paragraph)) {
        if (regular.widthOfTextAtSize(buffer + char, 10) > 510) { line(buffer); buffer = ""; }
        buffer += char;
      }
      line(buffer);
    }
  }
  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(`LUMARK | MXN | ${i + 1} / ${pages.length}`, { x: 42, y: 35, font: regular, size: 9, color: rgb(.4, .4, .4) }));
  return doc.save();
}

export function pdfResponse(bytes: Uint8Array, filename: string, download = false) {
  return new Response(new Uint8Array(bytes), { headers: {
    "content-type": "application/pdf",
    "content-disposition": `${download ? "attachment" : "inline"}; filename="${filename.replace(/[^a-zA-Z0-9_.-]/g, "_")}"`,
    "cache-control": "private, no-store",
  } });
}
