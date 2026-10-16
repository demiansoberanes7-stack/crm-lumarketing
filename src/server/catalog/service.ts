import { eq, ilike } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Catálogo — única fuente de verdad, compartida por la API interna del CRM y
 * por el MCP. Las rutas de /api/catalog delegan aquí para que crear o
 * actualizar un producto sea idéntico venga de la UI o de ChatGPT.
 */

export type CreateCatalogProductInput = {
  organizationId: string;
  name: string;
  shortDescription?: string | null;
  websiteUrl?: string | null;
  stock?: number | null;
  price: number;
  currency?: string;
};

export async function createCatalogProduct(
  input: CreateCatalogProductInput
): Promise<{ id: string }> {
  const id = newId("catalogProduct");
  await getDb().insert(schema.catalogProduct).values({
    id,
    organizationId: input.organizationId,
    name: input.name,
    shortDescription: input.shortDescription ?? null,
    websiteUrl: input.websiteUrl ?? null,
    stock: input.stock ?? null,
    price: input.price,
    currency: input.currency ?? "MXN",
  });
  return { id };
}

export type UpdateCatalogProductInput = {
  organizationId: string;
  productId: string;
  name?: string;
  shortDescription?: string | null;
  websiteUrl?: string | null;
  stock?: number | null;
  price?: number;
};

export type UpdateCatalogProductResult =
  | { ok: true }
  | { ok: false; code: "not_found"; message: string };

export async function updateCatalogProduct(
  input: UpdateCatalogProductInput
): Promise<UpdateCatalogProductResult> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.shortDescription !== undefined) set.shortDescription = input.shortDescription;
  if (input.websiteUrl !== undefined) set.websiteUrl = input.websiteUrl;
  if (input.stock !== undefined) set.stock = input.stock;
  if (input.price !== undefined) set.price = input.price;

  const updated = await getDb()
    .update(schema.catalogProduct)
    .set(set)
    .where(
      scoped(
        schema.catalogProduct.organizationId,
        input.organizationId,
        eq(schema.catalogProduct.id, input.productId)
      )
    )
    .returning({ id: schema.catalogProduct.id });

  if (updated.length === 0) {
    return { ok: false, code: "not_found", message: "Producto no encontrado" };
  }
  return { ok: true };
}

export async function getCatalogProduct(organizationId: string, productId: string) {
  const rows = await getDb()
    .select()
    .from(schema.catalogProduct)
    .where(
      scoped(
        schema.catalogProduct.organizationId,
        organizationId,
        eq(schema.catalogProduct.id, productId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listCatalogProducts(
  organizationId: string,
  opts?: { query?: string; limit?: number }
) {
  const search = opts?.query
    ? `%${opts.query.replace(/[\\%_]/g, "\\$&")}%`
    : null;
  return getDb()
    .select()
    .from(schema.catalogProduct)
    .where(
      scoped(
        schema.catalogProduct.organizationId,
        organizationId,
        search ? ilike(schema.catalogProduct.name, search) : undefined
      )
    )
    .limit(opts?.limit ?? 100);
}
