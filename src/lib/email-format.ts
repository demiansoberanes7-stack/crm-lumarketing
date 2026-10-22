/**
 * Lectura de un correo en partes: lo que escribió la persona, su firma y el
 * historial citado. Los clientes de correo arrastran el hilo completo en cada
 * respuesta; pintarlo entero convertía cada mensaje en un bloque ilegible.
 * Aquí se separa para mostrarlo colapsado bajo demanda.
 */

export type ParsedEmailBody = {
  /** Texto propio del mensaje, sin firma ni historial. */
  main: string;
  /** Firma tras la línea `-- `, si la hay. */
  signature: string | null;
  /** Historial citado (respuesta anterior o reenvío). */
  quoted: string | null;
};

/**
 * Un asunto viaja como cabecera: un salto de línea ahí permite inyectar
 * `Bcc:`/`Cc:` y convertir un correo en otro. Se colapsan los caracteres de
 * control antes de entregarlo a nodemailer, venga el texto de donde venga.
 */
export function sanitizeHeaderValue(value: string, max = 998): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

const QUOTE_HEADER =
  /^\s*(el|le|on)\s.+?\s(escribió|escribio|a écrit|wrote)\s*:\s*$/i;
const FORWARDED_HEADER =
  /^\s*-{2,}\s*(original message|mensaje original|forwarded message|mensaje reenviado)\s*-{2,}\s*$/i;
const UNDERSCORE_BLOCK = /^\s*_{8,}\s*$/;

/** Bloque de cabeceras tipo Outlook: `De:` seguido de `Enviado:`/`Para:`. */
function isHeaderBlock(lines: string[], index: number): boolean {
  if (!/^\s*(de|from):\s+\S/i.test(lines[index] ?? "")) return false;
  const window = lines.slice(index + 1, index + 6).join("\n");
  return /^\s*(enviado|sent|fecha|date|para|to):/im.test(window);
}

function isQuoteStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (index > 0 && /^\s*>/.test(line)) return true;
  if (QUOTE_HEADER.test(line) || FORWARDED_HEADER.test(line)) return true;
  if (UNDERSCORE_BLOCK.test(line)) return true;
  return isHeaderBlock(lines, index);
}

function cleanBlock(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseEmailBody(raw: string | null): ParsedEmailBody {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  if (!text.trim()) return { main: "", signature: null, quoted: null };

  const lines = text.split("\n");
  let quoteStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isQuoteStart(lines, i)) {
      quoteStart = i;
      break;
    }
  }

  let bodyLines = quoteStart >= 0 ? lines.slice(0, quoteStart) : lines;
  let quoted =
    quoteStart >= 0
      ? cleanBlock(lines.slice(quoteStart).join("\n")).replace(/^>\s?/gm, "")
      : null;

  // Si la "cita" empieza el mensaje no hay nada propio que mostrar: se trata
  // como cuerpo normal para no dejar la tarjeta vacía.
  if (!cleanBlock(bodyLines.join("\n")) && quoted) {
    bodyLines = lines;
    quoted = null;
  }

  let signature: string | null = null;
  for (let i = bodyLines.length - 1; i >= 0; i--) {
    if (/^--\s*$/.test(bodyLines[i] ?? "")) {
      const before = cleanBlock(bodyLines.slice(0, i).join("\n"));
      const after = cleanBlock(bodyLines.slice(i + 1).join("\n"));
      if (before && after) {
        signature = after;
        bodyLines = bodyLines.slice(0, i);
      }
      break;
    }
  }

  return {
    main: cleanBlock(bodyLines.join("\n")),
    signature,
    quoted: quoted || null,
  };
}

/** Texto corto para el renglón de la lista: nunca el historial citado. */
export function emailSnippet(raw: string | null, max = 90): string {
  const parsed = parseEmailBody(raw);
  const source = parsed.main || parsed.quoted || "";
  const flat = source.replace(/\s+/g, " ").trim();
  return flat.slice(0, max);
}
