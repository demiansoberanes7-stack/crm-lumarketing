import { sanitizeHeaderValue } from "@/lib/email-format";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Un nombre con `<` no puede convertirse en marcado dentro de la plantilla. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

function recipientName(recipient: { email: string; name: string | null }): string {
  const fallback = recipient.email.split("@")[0] || "";
  return sanitizeHeaderValue(recipient.name?.trim() || fallback, 255) || fallback;
}

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
  const name = recipientName(recipient);
  // Reemplazo por función: "$&" o "$'" dentro del nombre no son patrones.
  return text
    .replace(/\{\{\s*nombre\s*\}\}/gi, () => name)
    .replace(/\{\{\s*correo\s*\}\}/gi, () => recipient.email);
}

/** Igual que el asunto, pero los valores se escapan antes de entrar al HTML. */
export function personalizeHtml(
  html: string,
  recipient: { email: string; name: string | null }
): string {
  const name = escapeHtml(recipientName(recipient));
  const email = escapeHtml(recipient.email);
  return html
    .replace(/\{\{\s*nombre\s*\}\}/gi, () => name)
    .replace(/\{\{\s*correo\s*\}\}/gi, () => email);
}

/**
 * Texto plano de respaldo para una plantilla HTML. Los clientes que no pintan
 * HTML (o los filtros antispam) necesitan una parte de texto; si el HTML no
 * aporta texto legible se envía una línea que lo explica.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|title|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|table|section|article)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 50_000);
  return text || "Abre este correo en un cliente compatible con HTML para ver su contenido.";
}
