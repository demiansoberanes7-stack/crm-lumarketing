/**
 * Comodines de `LIKE` tratados como texto literal.
 *
 * Sin esto, buscar «100%» o «_promo» en un listado convierte el `%` y el `_`
 * del término en comodines reales: `ilike(nombre, '%100%%')` casa con cualquier
 * cosa que contenga «100» y, peor, un `%` solo como búsqueda hace barrer la
 * tabla entera devolviendo 200 filas. El `\` se escapa primero para no
 * duplicarse a sí mismo.
 *
 * Es el mismo escapado que ya usaba `src/server/ai/inventory.ts`; se comparte
 * porque ahora hay dos superficies de búsqueda (la del agente y la de
 * Proveedores) y la clase de bug es la misma.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** `%término%` literal, listo para `like`/`ilike`. */
export function likeContains(value: string): string {
  return `%${escapeLike(value)}%`;
}
