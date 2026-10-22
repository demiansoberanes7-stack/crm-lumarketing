/** Variables de personalización aceptadas en asunto y cuerpo. */
export function personalizeEmail(
  text: string,
  recipient: { email: string; name: string | null }
): string {
  const name = recipient.name?.trim() || recipient.email.split("@")[0] || "";
  return text
    .replace(/\{\{\s*nombre\s*\}\}/gi, name)
    .replace(/\{\{\s*correo\s*\}\}/gi, recipient.email);
}
