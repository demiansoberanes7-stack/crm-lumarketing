import { and, asc, desc, or, sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { likeContains } from "@/lib/db/like";
import { scoped } from "@/lib/db/tenant";

/**
 * Consulta de inventario del agente. El catálogo del prompt va acotado; esta
 * búsqueda cubre el resto sin volcar todo el inventario en cada turno.
 *
 * La comparación ignora mayúsculas y acentos con `translate` (función de
 * PostgreSQL, sin depender de la extensión `unaccent`). Cada palabra de la
 * consulta debe aparecer en nombre o descripción: «ramo rojo» no devuelve
 * todos los ramos.
 */

const MAX_TERMS = 5;
export const INVENTORY_RESULT_LIMIT = 8;

export type InventoryProduct = Pick<
  typeof schema.catalogProduct.$inferSelect,
  "id" | "name" | "price" | "currency" | "stock" | "available" | "shortDescription"
>;

function searchTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const term = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    if (term.length < 2 || seen.has(term)) continue;
    seen.add(term);
    if (seen.size >= MAX_TERMS) break;
  }
  return [...seen];
}

function folded(column: AnyColumn) {
  return sql`translate(lower(${column}), 'áéíóúüñ', 'aeiouun')`;
}

export async function searchInventory(
  organizationId: string,
  query: string,
  limit = INVENTORY_RESULT_LIMIT
): Promise<InventoryProduct[]> {
  const normalized = query.trim().slice(0, 100);
  if (!normalized) return [];
  const terms = searchTerms(normalized);
  const patterns = terms.length > 0 ? terms : [normalized.toLowerCase()];
  const fields = [
    schema.catalogProduct.name,
    schema.catalogProduct.shortDescription,
    schema.catalogProduct.longDescription,
  ];

  const matches = patterns.map((term) => {
    const pattern = likeContains(term);
    return or(...fields.map((field) => sql`${folded(field)} LIKE ${pattern}`))!;
  });

  return getDb()
    .select({
      id: schema.catalogProduct.id,
      name: schema.catalogProduct.name,
      price: schema.catalogProduct.price,
      currency: schema.catalogProduct.currency,
      stock: schema.catalogProduct.stock,
      available: schema.catalogProduct.available,
      shortDescription: schema.catalogProduct.shortDescription,
    })
    .from(schema.catalogProduct)
    .where(
      scoped(
        schema.catalogProduct.organizationId,
        organizationId,
        and(...matches)
      )
    )
    .orderBy(desc(schema.catalogProduct.available), asc(schema.catalogProduct.name))
    .limit(Math.min(Math.max(limit, 1), 20));
}

/** Resultado compacto para el modelo: sin descripciones largas ni URLs. */
export function renderInventoryResults(products: InventoryProduct[]): string {
  if (products.length === 0) return "(sin coincidencias en el inventario)";
  return products
    .map((product) => {
      const price = `$${(product.price / 100).toFixed(2)} ${product.currency}`;
      const stock =
        product.stock === null
          ? "sin control de stock"
          : product.stock <= 0
            ? "agotado"
            : `${product.stock} pieza${product.stock === 1 ? "" : "s"}`;
      const availability = product.available ? "" : " | NO DISPONIBLE (no cotizar)";
      const description = product.shortDescription ? ` | ${product.shortDescription}` : "";
      return `- ID: ${product.id} | ${product.name} | ${price} | Inventario: ${stock}${availability}${description}`;
    })
    .join("\n");
}
