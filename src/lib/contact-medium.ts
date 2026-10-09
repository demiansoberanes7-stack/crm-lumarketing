/**
 * Medio por el que se contactó primero.
 *
 * No confundir con `source` (`src/server/contact-source.ts`), que dice de
 * DÓNDE salió el prospecto — anuncio, referido, contenido orgánico. Esto dice
 * por qué CANAL llegó la primera conversación: una red social (y cuál), una
 * llamada, un correo o en persona. Ejes distintos que se responden aparte en
 * la ficha, así que viven en columnas distintas.
 *
 * Todo puro y sin dependencias: lo usan los formularios del cliente y las
 * rutas de la API desde el mismo catálogo, para que no haya dos listas.
 */

export const MEDIUM_VALUES = [
  "red_social",
  "llamada",
  "correo",
  "presencial",
  "otro",
] as const;
export type MediumValue = (typeof MEDIUM_VALUES)[number];

/** Solo las opciones que pide "red social": la red con la que llegó. */
export const SOCIAL_NETWORKS = [
  "whatsapp",
  "instagram",
  "facebook",
  "tiktok",
  "x",
  "linkedin",
  "youtube",
  "otra",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const MEDIUM_LABELS: Record<MediumValue, string> = {
  red_social: "Red social",
  llamada: "Llamada",
  correo: "Correo",
  presencial: "Presencial",
  otro: "Otro",
};

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  x: "X (Twitter)",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  otra: "Otra red",
};

export function isMediumValue(value: unknown): value is MediumValue {
  return typeof value === "string" && (MEDIUM_VALUES as readonly string[]).includes(value);
}

export function isSocialNetwork(value: unknown): value is SocialNetwork {
  return typeof value === "string" && (SOCIAL_NETWORKS as readonly string[]).includes(value);
}

/** Lo que se pinta en el chip y se devuelve en la API: "Red social · Instagram". */
export function mediumLabel(
  medium: string | null | undefined,
  detail?: string | null
): string | null {
  if (!isMediumValue(medium)) return null;
  if (medium !== "red_social") return MEDIUM_LABELS[medium];
  return isSocialNetwork(detail)
    ? `${MEDIUM_LABELS.red_social} · ${SOCIAL_LABELS[detail]}`
    : MEDIUM_LABELS.red_social;
}

export type MediumInput =
  | { ok: true; medium: MediumValue | null; mediumDetail: string | null }
  | { ok: false; error: string };

/**
 * Normaliza lo que mandó el formulario o la API antes de tocar la BD.
 *
 * Reglas que así se cumplen en un solo lugar:
 * - vacío = sin capturar (null en las dos columnas, no "otro");
 * - sin `red_social` no hay detalle que guardar (se descarta, no se conserva
 *   una red vieja junto a un medio nuevo);
 * - `red_social` SIN red elegida se rechaza: guardar "red social" a medias
 *   deja el chip sin poder decir cuál fue.
 */
export function normalizeMedium(input: {
  medium?: unknown;
  mediumDetail?: unknown;
}): MediumInput {
  const { medium, mediumDetail } = input;
  if (medium === undefined || medium === null || medium === "") {
    return { ok: true, medium: null, mediumDetail: null };
  }
  if (!isMediumValue(medium)) {
    return { ok: false, error: "El medio no es uno de los reconocidos." };
  }
  if (medium !== "red_social") return { ok: true, medium, mediumDetail: null };
  if (!isSocialNetwork(mediumDetail)) {
    return { ok: false, error: "Elige con qué red social se contactó." };
  }
  return { ok: true, medium, mediumDetail };
}
