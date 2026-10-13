/**
 * La marca LUMARK — logo y colores de identidad.
 *
 * Vive aquí, sin React, porque la usan dos mundos: los componentes (el trazo
 * del panel lateral y del login) y el servidor (el favicon generado que se
 * sirve como texto).
 *
 * El trazo es una "L" geométrica con acento luminoso.
 */

/** Cuerpo de la "L": se pinta con el color del contexto. */
export const BRAND_MARK_BODY =
  "M4 4v16h2.5V11.5H16V9H6.5V4H4z";

/** Remate luminoso, siempre en el verde-lima de la marca. */
export const BRAND_MARK_TAIL = "M12 5h4v2h-4V5z";

export const BRAND_MARK_STROKE = 3.4;

/** Lima luminoso sobre fondos claros. */
export const BRAND_ACCENT = "#65a30d";

/** Lima luminoso sobre fondos oscuros. */
export const BRAND_ACCENT_ON_TILE = "#a3e635";

/**
 * ¿Esta instancia se llama LUMARK? Solo entonces se dibuja el logo.
 */
export function isLumarkName(name: string): boolean {
  return name.trim().toLowerCase() === "lumark";
}
