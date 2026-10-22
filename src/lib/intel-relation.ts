/**
 * Relación entre una búsqueda libre y los nichos del catálogo, tal como la
 * devuelve `/api/intel/keyword` en `catalogMatches`.
 *
 * Vive en `lib` (y no en `server/intel/terms.ts`) porque la usa el cliente:
 * `terms.ts` importa `@/lib/db` y arrastraría la base de datos al bundle del
 * navegador. Aquí no se recalcula similitud: solo se ordena y se etiqueta lo
 * que el servidor ya midió, para que ningún panel quede sin declarar su
 * relación con la consulta.
 */

export type CatalogMatch = {
  termId: string;
  name: string;
  /** 0–1: palabras compartidas sobre el total; 0 = ninguna. */
  score: number;
  /** Texto del catálogo con el que puntuó; vacío cuando no compartió nada. */
  via: string;
  /** true si el score cruza el umbral: la consulta ES ese nicho. */
  exact: boolean;
};

export type IntelRelation = {
  query: string;
  /** Todos los nichos recibidos, de más a menos parecido. */
  matches: CatalogMatch[];
  exact: CatalogMatch | null;
  /** Primero con alguna palabra en común (incluye el exacto, si lo hay). */
  nearest: CatalogMatch | null;
  total: number;
  relatedCount: number;
};

/**
 * Sin búsqueda no hay relación que declarar (`null`). Con búsqueda, cada
 * nicho recibido entra en `matches`, incluidos los de score 0, para que la
 * pantalla pueda decir «sin palabras en común» en vez de mostrar paneles
 * ajenos a la consulta como si fueran su resultado.
 */
export function intelRelation(
  query: string | null | undefined,
  matches: CatalogMatch[] | null | undefined
): IntelRelation | null {
  const q = query?.trim() ?? "";
  if (!q) return null;
  const ordered = [...(matches ?? [])].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name)
  );
  return {
    query: q,
    matches: ordered,
    exact: ordered.find((m) => m.exact) ?? null,
    nearest: ordered.find((m) => m.score > 0) ?? null,
    total: ordered.length,
    relatedCount: ordered.filter((m) => m.score > 0).length,
  };
}

/** Etiqueta corta y verificable de un nicho frente a la búsqueda. */
export function relationLabel(
  match: { score: number; exact: boolean } | null | undefined
): string | null {
  if (!match) return null;
  if (match.exact) return "es tu búsqueda";
  if (match.score > 0) return `${Math.round(match.score * 100)}% parecido`;
  return "sin palabras en común";
}

/**
 * Orden de presentación: primero el nicho que ES la búsqueda, luego los que
 * comparten palabras y al final los que no. No esconde nada; solo hace que el
 * panel empiece por lo relacionado.
 */
export function relationRank(match: CatalogMatch | null | undefined): number {
  if (!match) return -1;
  if (match.exact) return 2;
  return match.score > 0 ? 1 : 0;
}

/** Índice `termId → match` para etiquetar cualquier panel sin recorrer listas. */
export function relationIndex(matches: CatalogMatch[]): Map<string, CatalogMatch> {
  return new Map(matches.map((m) => [m.termId, m]));
}
