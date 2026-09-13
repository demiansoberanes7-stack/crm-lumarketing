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

/** Remate luminoso, siempre ámbar dorado. */
export const BRAND_MARK_TAIL = "M12 5h4v2h-4V5z";

export const BRAND_MARK_STROKE = 3.4;

/** Dorado luminoso sobre fondos claros. */
export const BRAND_CYAN = "#D4A843";

/** Dorado luminoso sobre fondos oscuros. */
export const BRAND_CYAN_ON_TILE = "#E8C060";

/**
 * ¿Esta instancia se llama LUMARK? Solo entonces se dibuja el logo.
 */
export function isVoceroName(name: string): boolean {
  return name.trim().toLowerCase() === "lumark";
}
