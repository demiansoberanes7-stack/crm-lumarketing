/**
 * La marca Zorro Tech — logo y colores de identidad.
 *
 * Vive aquí, sin React, porque la usan dos mundos: los componentes (el trazo
 * del panel lateral y del login) y el servidor (el favicon generado que se
 * sirve como texto).
 *
 * El trazo es una "Z" geométrica: la barra superior y la diagonal heredan el
 * color del contexto, y la barra inferior lleva el acento luminoso.
 */

/** Cuerpo de la "Z": barra superior y diagonal. */
export const BRAND_MARK_BODY = "M5 6h14L5 18";

/** Remate luminoso: la barra inferior de la "Z". */
export const BRAND_MARK_TAIL = "M5 18h14";

export const BRAND_MARK_STROKE = 3.4;

/** Lima luminoso sobre fondos claros. */
export const BRAND_ACCENT = "#65a30d";

/** Lima luminoso sobre fondos oscuros. */
export const BRAND_ACCENT_ON_TILE = "#a3e635";

/** Lema de la marca madre. */
export const BRAND_TAGLINE = "Gestor de comunicación y proyectos";

/**
 * ¿Esta instancia se llama Zorro Tech? Solo entonces se dibuja el logo.
 * Se acepta el nombre completo y el corto ("Zorro"), sin distinguir mayúsculas
 * ni espacios repetidos.
 */
export function isZorroTechName(name: string): boolean {
  const normalizado = name.trim().toLowerCase().replace(/\s+/g, " ");
  return normalizado === "zorro tech" || normalizado === "zorro";
}
