import { getQuote } from "./service";
import { reportPdf, money } from "@/server/documents/pdf";
export async function quotePdf(organizationId: string, id: string) {
  const quote = await getQuote(organizationId, id);
  if (!quote) return null;
  const bytes = await reportPdf(`Cotización ${quote.quoteNumber}`, [
    `Cliente: ${quote.contactName ?? "Sin contacto"}`,
    `Fecha: ${quote.createdAt.toLocaleDateString("es-MX")} | Versión: ${quote.version}`,
    `Vigencia: ${quote.validUntil?.toLocaleDateString("es-MX") ?? "Sin fecha"}`,
    "", "PARTIDAS", "",
    ...quote.items.flatMap((item, index) => [`${index + 1}. ${item.name}`, ...(item.description ? [item.description] : []), `${item.quantity} x ${money(item.unitPrice)} = ${money(item.quantity * item.unitPrice)}`, ""]),
    `Subtotal: ${money(quote.subtotal)}`, `Descuento: ${money(quote.discountAmount)}`,
    `IVA (${quote.taxRate}%): ${money(quote.taxAmount)}`, `TOTAL: ${money(quote.total)} MXN`,
    "", "Notas:", quote.message ?? "", "", "Cotización comercial. No es un comprobante fiscal.",
  ]);
  return { bytes, filename: `${quote.quoteNumber}.pdf` };
}
