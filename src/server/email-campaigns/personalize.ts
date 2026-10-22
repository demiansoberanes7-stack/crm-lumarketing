import { sanitizeHeaderValue } from "@/lib/email-format";

/**
 * Variables de personalización aceptadas en asunto y cuerpo.
 *
 * El nombre puede venir de una ficha o de una hoja de cálculo; un salto de
 * línea ahí acabaría en el asunto como una cabecera inyectada.
 */
export function personalizeEmail(
  text: string,
  recipient: { email: string; name: string | null }
): string {
  const fallback = recipient.email.split("@")[0] || "";
  const name =
    sanitizeHeaderValue(recipient.name?.trim() || fallback, 255) || fallback;
  return text
    .replace(/\{\{\s*nombre\s*\}\}/gi, name)
    .replace(/\{\{\s*correo\s*\}\}/gi, recipient.email);
}
