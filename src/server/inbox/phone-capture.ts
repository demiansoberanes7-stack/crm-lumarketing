import { and, eq, isNull } from "drizzle-orm";
import { normalizeMx } from "@/lib/meta/client";
import { normalizeText } from "@/lib/search";
import { getDb, schema } from "@/lib/db";

/**
 * Teléfono que el cliente deja escrito en el chat.
 *
 * Existe porque los prospectos de Instagram, Messenger y TikTok llegan sin
 * número (su webhook no lo trae) y los de WhatsApp que entran por BSUID
 * tampoco. Si el cliente lo escribe, el CRM lo captura solo: ese número es lo
 * que convierte un "platicó con nosotros" en un lead contactable.
 */

export type ExtractedPhone = {
  /** Dígitos canónicos, sin `+` ni separadores: el formato de `contact.phone`. */
  phone: string;
  /** El texto tal como lo escribió el cliente. */
  raw: string;
  /** Por qué se decidió que era un teléfono; va al log. */
  reason: "plus" | "largo" | "separado" | "indicio";
};

/**
 * Tres formas de buscar, porque una sola falla:
 * - CONTIGUOUS: "4621345678", "5214621345678". Un patrón que exigiera
 *   separadores nunca los vería.
 * - SHAPED: "462 134 5678", "443-123-45-67", "(462) 13 45 678". Primer bloque
 *   de 1-3 dígitos (país o área) y luego de 2 a 6 bloques de hasta 5. Sin esta
 *   forma "10 4621345678" (una cantidad pegada al número) se leería como un
 *   teléfono de 12 dígitos; con ella el bloque de 10 no cabe y CONTIGUOUS
 *   recupera el número suelto.
 * - PLUS: "+52 4621345678". El `+` es la única señal de que el bloque corto de
 *   enfrente es un código de país y no una cantidad, así que solo con `+` se
 *   aceptan dos bloques. "52 4621345678" sin `+` queda en "4621345678": se
 *   pierde el litoral, pero no se inventa un número.
 *
 * `(?<!\d)` y `(?!\d)` impiden partir una cifra larga: de "50012345678" no se
 * puede tomar el sufijo de 10 dígitos y llamarlo teléfono.
 */
const CONTIGUOUS = /(?<!\d)(\+?\d{8,15})(?!\d)/g;
const PLUS = /(?<!\d)(\+\d{1,3}[\s.()-]?\d{7,14})(?!\d)/g;
const SHAPED =
  /(?<!\d)(?:\(\d{2,4}\)|\+?\d{1,3})(?:[\s.()-]+\d{1,5}){2,6}(?!\d)/g;

/** Con lo que alguien anuncia su número, en minúsculas y sin acentos. */
const PHONE_CUES = [
  "telefono",
  "tel",
  "celular",
  "cel",
  "whatsapp",
  "wapp",
  "wsp",
  "numero",
  "llamame",
  "marcame",
  "contactarme",
];

/** YYYYMMDD: ocho dígitos que son una fecha, no un número. */
const AS_DATED = /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;

/**
 * La fecha escrita como la escribe cualquiera: "15-10-2026", "15/10/2026",
 * "15.10.2026". Ocho dígitos con dos separadores cae justo en el rango que
 * acepta la regla `separado`, así que sin este filtro «te lo entrego el
 * 15-10-2026» quedaba grabado como el teléfono del cliente.
 */
const AS_DATE_WRITTEN = /^(\d{1,2})([-./])(\d{1,2})\2\d{4}$/;

function looksLikeDate(digits: string, raw: string): boolean {
  if (AS_DATED.test(digits)) return true;
  // Fecha con hora (20261015143000): empieza por siglo y trae mes y día.
  if (
    (digits.length === 14 || digits.length === 17) &&
    /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/.test(digits)
  ) return true;

  const parts = AS_DATE_WRITTEN.exec(raw);
  if (!parts) return false;
  const a = Number(parts[1]);
  const b = Number(parts[3]);
  // Sirve en ambos órdenes (DD/MM y MM/DD): aquí ser flexible solo evita
  // grabar basura, nunca pierde un número real.
  return (a <= 31 && b <= 12) || (a <= 12 && b <= 31);
}

/**
 * Un número pegado a `$`, "pesos" o "mxn" es un precio. Es la única confusión
 * que se ve de verdad en chats de cotización.
 */
function isPrice(text: string, from: number, to: number): boolean {
  const before = normalizeText(text.slice(Math.max(0, from - 4), from));
  const after = normalizeText(text.slice(to, Math.min(text.length, to + 8)));
  return before.includes("$") || after.includes("pesos") || after.includes("mxn");
}

type Candidate = {
  raw: string;
  from: number;
  to: number;
  /** Dígitos ya normalizados (521 + 10 → 52 + 10). */
  digits: string;
  separated: boolean;
  plus: boolean;
};

function collect(text: string, pattern: RegExp): Candidate[] {
  const out: Candidate[] = [];
  for (const match of text.matchAll(pattern)) {
    // `match[0]` y no un grupo: SHAPED no captura, y el `+` o los paréntesis
    // que abren el bloque sí cuentan para decidir si es teléfono.
    const full = match[0]?.trim();
    if (!full) continue;
    const from = text.indexOf(full, match.index ?? 0);
    if (from < 0) continue;
    out.push({
      raw: full,
      from,
      to: from + full.length,
      digits: full.replace(/\D/g, ""),
      separated: /[\s.()-]/.test(full),
      plus: full.startsWith("+"),
    });
  }
  return out;
}

/**
 * El teléfono más probable del mensaje, o null.
 *
 * Acepta un candidato si cumple UNA de estas reglas:
 * - `plus`: empezó con `+` (nadie firma un precio con código de país).
 * - `largo`: 10-15 dígitos canónicos.
 * - `separado`: 8-9 dígitos escritos con separadores, o sea marcados a mano.
 * - `indicio`: el mensaje habla de teléfono/celular/WhatsApp y el candidato
 *   tiene 8-15 dígitos.
 *
 * Descarta siempre fechas camufladas, precios y lo que empiece por `0` (ningún
 * número nacional real empieza así). Si quedan varios, gana el de más dígitos:
 * una cantidad suelta es corta, un teléfono no.
 */
export function extractPhoneFromText(
  text: string | null | undefined
): ExtractedPhone | null {
  if (!text) return null;
  const hasCue = PHONE_CUES.some((cue) => normalizeText(text).includes(cue));

  const accepted: (Candidate & { phone: string; reason: ExtractedPhone["reason"] })[] = [];
  const seen = new Set<string>();
  for (const candidate of [
    ...collect(text, CONTIGUOUS),
    ...collect(text, PLUS),
    ...collect(text, SHAPED),
  ]) {
    if (seen.has(candidate.raw)) continue;
    seen.add(candidate.raw);
    if (candidate.digits.length < 8 || candidate.digits.length > 15) continue;
    if (candidate.digits.startsWith("0")) continue;
    if (looksLikeDate(candidate.digits, candidate.raw)) continue;
    if (isPrice(text, candidate.from, candidate.to)) continue;

    const phone = normalizeMx(candidate.digits);
    const reason: ExtractedPhone["reason"] | null = candidate.plus
      ? "plus"
      : phone.length >= 10 && phone.length <= 15
        ? "largo"
        : candidate.separated && phone.length >= 8
          ? "separado"
          : hasCue && phone.length >= 8
            ? "indicio"
            : null;
    if (!reason) continue;
    accepted.push({ ...candidate, phone, reason });
  }

  accepted.sort(
    (a, b) =>
      Number(b.plus) - Number(a.plus) ||
      b.phone.length - a.phone.length ||
      a.from - b.from
  );
  const best = accepted[0];
  return best ? { phone: best.phone, raw: best.raw, reason: best.reason } : null;
}

/**
 * Anota el teléfono en el contacto SOLO si todavía no tiene ninguno.
 *
 * Superficies que la llaman: todo lo que pasa por `ingestInboundMessage`
 * (WhatsApp por WAHA y por Zernio, Instagram, Messenger y TikTok) más el
 * poller de Mercado Libre, que inserta sus mensajes aparte. Se dejan fuera a
 * propósito
 * los comentarios públicos y las reseñas de Google Business: allí el número que
 * aparece suele ser el del propio negocio o ruido, y escribirlo en la ficha del
 * contacto sería contaminar el dato con el que después se llama al cliente.
 *
 * No pisa nunca el número de la identidad de WhatsApp ni el que escribió un
 * operador: `phone is null` está en el WHERE, así que un reintento de Meta o
 * una carrera con la UI no reescriben un dato ya confirmado. Devuelve el
 * número capturado, o null si no había nada que tomar.
 */
export async function captureContactPhoneFromText(input: {
  organizationId: string;
  contactId: string;
  existingPhone: string | null;
  text: string | null | undefined;
}): Promise<string | null> {
  if (input.existingPhone) return null;
  const found = extractPhoneFromText(input.text);
  if (!found) return null;

  const db = getDb();
  const updated = await db
    .update(schema.contact)
    .set({ phone: found.phone, updatedAt: new Date() })
    .where(
      and(
        eq(schema.contact.id, input.contactId),
        eq(schema.contact.organizationId, input.organizationId),
        isNull(schema.contact.phone)
      )
    )
    .returning({ id: schema.contact.id });

  if (updated.length === 0) return null;
  console.log(
    `[prospectos] teléfono capturado del chat en el contacto ${input.contactId} (${found.reason}): ${found.phone}`
  );
  return found.phone;
}
