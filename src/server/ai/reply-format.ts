import type { Channel } from "@/lib/channels";
import { capabilitiesFor } from "@/server/channels/capabilities";

/**
 * Formato de las respuestas del agente para que se lean ordenadas en el móvil.
 *
 * El modelo escribe prosa corrida —el catálogo enumerado en un solo párrafo es
 * el caso que reporta el dueño— y cada canal renderiza distinto: WhatsApp sí
 * entiende `*negrita*`, Instagram y Messenger imprimen los asteriscos tal cual.
 * Aquí se normaliza lo que el modelo devuelva ANTES de enviar, así que el
 * contrato del prompt es la aspiración y esto es la red.
 */

/** Canales donde `*texto*` es negrita de verdad. En los demás, estorba. */
const MARKDOWN_CAPABLE = new Set<Channel>(["whatsapp"]);

/** Un solo sitio decide qué canales renderizan markdown de WhatsApp. */
export function supportsWhatsAppMarkdown(channel: Channel | undefined): boolean {
  return channel !== undefined && MARKDOWN_CAPABLE.has(channel);
}

/** Renglón larguísimo: se parte por oraciones, no por palabras. */
const LONG_LINE_CHARS = 220;

/** Umbral de enumeración: a partir de 3 elementos separados, lista. */
const MIN_LIST_ITEMS = 3;

function cleanWhitespace(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    // Los espacios dobles que deja el modelo (o el quite de marcadores) rompen
    // la sangría pareja que se pidió en el móvil.
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/g, ""));
  const out: string[] = [];
  for (const line of lines) {
    if (line === "" && out[out.length - 1] === "") continue; // nunca dos líneas en blanco seguidas
    out.push(line);
  }
  while (out.length > 0 && out[0] === "") out.shift();
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** `**x**` → `*x*`, títulos markdown → negrita, enlaces → texto + URL. */
function toWhatsAppMarkdown(line: string): string {
  return line
    .replace(/\*\*\s*([^*]+?)\s*\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+(.+)$/g, "*$1*")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    .replace(/`([^`]+)`/g, "$1");
}

/** Sin negrita de canal: se quitan los marcadores, la palabra se queda. */
function stripEmphasis(line: string): string {
  return line
    .replace(/\*\*\s*([^*]+?)\s*\*\*/g, "$1")
    .replace(/^\*([^*]+)\*$/g, "$1")
    // El espacio NO se consume: al reponerlo con " $1" un `*x*` precedido de
    // dos espacios dejaba uno de más y la lista perdía la sangría pareja.
    .replace(/(?:^|(?<=\s))\*([^*\n]+)\*(?=\s|$)/g, "$1")
    // `_texto_` solo cuando es de verdad un énfasis: sin esto,
    // `https://tienda.com/a_b_c_x` se convertía en `https://tienda.com/abc_x`.
    .replace(/(?<![\w/])_([^_\n]+)_(?![\w/])/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    .replace(/`([^`]+)`/g, "$1");
}

const BULLET = /^[•·*\-+]\s+/;

/** Un viñeta por renglón, todas con el mismo marcador. */
function normalizeBullet(line: string): string {
  if (!BULLET.test(line)) return line;
  return `• ${line.replace(BULLET, "").trim()}`;
}

const PRICE_TOKEN = /\$\s?\d/;

/**
 * El último tramo de una enumeración suele venir pegado con «y»:
 * "cristales $149 y audífonos $349". Se parte solo si cada mitad trae su
 * propio precio, porque "para ti y para regalo" no es una lista.
 */
function splitTrailingConjunction(part: string): string[] {
  const chunks = part.split(/\s+(?:y|e)\s+/u);
  if (chunks.length < 2) return [part];
  return chunks.every((chunk) => PRICE_TOKEN.test(chunk)) ? chunks : [part];
}

/**
 * Párrafo amontonado → lista. Sólo cuando de verdad es una enumeración: varios
 * `", "`/`"; "`, elementos cortos y (precios o 4+ elementos). Un texto normal
 * con comas no se toca, porque partirlo saldría peor.
 */
function splitCrammedEnumeration(line: string): string[] | null {
  if (BULLET.test(line)) return null;
  if (line.length < 60) return null;
  if (/\.\s\p{Lu}/u.test(line)) return null; // prosa con frases hechas
  const parts = line
    .split(/,\s+|;\s+/u)
    .flatMap((part) => splitTrailingConjunction(part.trim()))
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < MIN_LIST_ITEMS) return null;
  if (parts.some((part) => part.length > 60)) return null;
  const prices = (line.match(new RegExp(PRICE_TOKEN.source, "gu")) ?? []).length;
  if (prices < 2 && parts.length < 4) return null;
  // El punto de la última pieza es el final del párrafo, no del elemento: en
  // una lista sobra y rompe la simetría de las viñetas.
  return parts.map((part) => `• ${part.replace(/[,.;:]+$/u, "")}`);
}

/** Renglón kilométrico: se corta por oraciones para que respire. */
function breakLongLine(line: string): string[] {
  if (line.length <= LONG_LINE_CHARS || BULLET.test(line)) return [line];
  const sentences = line.split(/(?<=[.!?])\s+/u).filter(Boolean);
  if (sentences.length < 2) return [line];
  return sentences;
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/**
 * Ajusta el texto al tope real del canal. `sendText` RECHAZA un texto largo
 * antes de persistir nada, así que sin esto el cliente no recibía mensaje
 * alguno. Primero se sacrifica el aire que añadió el formateador; solo si aún
 * no cabe se corta por renglón — un mensaje incompleto supera a ninguno.
 */
export function fitsChannel(text: string, channel: Channel): string {
  const budget = capabilitiesFor(channel).maxTextBytes;
  if (!budget || bytes(text) <= budget) return text;

  const collapsed = text.replace(/\n{2,}/g, "\n");
  if (bytes(collapsed) <= budget) return collapsed;

  const ellipsis = "…";
  const reserve = bytes(ellipsis) + 1;
  const kept: string[] = [];
  let used = 0;
  for (const line of collapsed.split("\n")) {
    const cost = bytes(line) + (kept.length ? 1 : 0);
    if (used + cost + reserve > budget) break;
    kept.push(line);
    used += cost;
  }
  if (kept.length > 0) return `${kept.join("\n")}\n${ellipsis}`;

  // Ni el primer renglón cabe: se corta por bytes sin partir un caracter.
  let out = "";
  for (const char of collapsed) {
    if (bytes(out + char) + reserve > budget) break;
    out += char;
  }
  return `${out}${ellipsis}`;
}

export function formatAgentReply(
  text: string,
  channel?: Channel
): string {
  const bold = supportsWhatsAppMarkdown(channel);
  const source = cleanWhitespace(text);
  const out: string[] = [];
  for (const rawLine of source.split("\n")) {
    const line = bold ? toWhatsAppMarkdown(rawLine) : stripEmphasis(rawLine);
    const items = splitCrammedEnumeration(line) ?? [line];
    for (const item of items) {
      const bullet = normalizeBullet(item);
      for (const piece of breakLongLine(bullet)) {
        // Aire antes de cada bloque de viñetas: la lista se ve como lista.
        const previous = out[out.length - 1];
        if (piece.startsWith("• ") && previous !== undefined && previous !== "" && !previous.startsWith("• ")) {
          out.push("");
        }
        out.push(piece);
      }
    }
  }
  return out.join("\n").trim();
}
