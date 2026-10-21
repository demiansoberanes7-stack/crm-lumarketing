import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Ordenar DESC dejando los NULL al final.
 *
 * Postgres pone los NULL **primero** en un `ORDER BY … DESC`. En la elección de
 * «la oportunidad de un contacto» (`isPrimary` y, entre iguales, la de
 * `lastActivityAt` más reciente, siempre con `limit(1)`) eso significaba que un
 * lead sin actividad registrada le ganaba al que sí está trabajando: la
 * pantalla mostraba la etapa vieja. Columns `notNull` como `createdAt` no
 * tienen este problema.
 */
export function descNullsLast(column: PgColumn): SQL {
  return sql`${column} desc nulls last`;
}
