/**
 * Nombre del archivo PDF de una cotización que se adjunta en el chat.
 *
 * Se separa del servicio para que el test ejercite el código REAL: antes el
 * test reimplementaba el regex inline, o sea que pasaba aunque el servicio
 * estuviera roto.
 */
const UNSAFE_CHARS = /[\/\\:*?"<>|]/g;
const MAX_SEGMENT = 60;

function sanitizeSegment(value: string, fallback: string): string {
  return value.replace(UNSAFE_CHARS, "").slice(0, MAX_SEGMENT).trim() || fallback;
}

export function quotePdfFileName(productName: string, contactName: string): string {
  return `Cotizacion ${sanitizeSegment(productName, "Cotizacion")} - ${sanitizeSegment(contactName, "Cliente")}.pdf`;
}
