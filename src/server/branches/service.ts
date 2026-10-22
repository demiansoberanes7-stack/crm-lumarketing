import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { BranchDto, BranchInventoryDto } from "@/lib/types";

/**
 * Sucursales e inventario por sucursal.
 *
 * Todas las consultas se scopean por organización. El inventario de sucursal es
 * un control físico aparte del `catalog_product.stock` general: aquí no se
 * escribe el stock del catálogo ni el cotizador lo descuenta.
 */

export type BranchInput = {
  name: string;
  address?: string | null;
  phone?: string | null;
  notes?: string | null;
  active?: boolean;
};

export type UpdateBranchResult =
  | { ok: true }
  | { ok: false; code: "not_found"; message: string };

export type SetBranchQuantityResult =
  | { ok: true }
  | {
      ok: false;
      code: "branch_not_found" | "product_not_found";
      message: string;
    };

/** Texto opcional: recorta y convierte vacío en null. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function listBranches(organizationId: string): Promise<BranchDto[]> {
  const rows = await getDb()
    .select({
      id: schema.branch.id,
      name: schema.branch.name,
      address: schema.branch.address,
      phone: schema.branch.phone,
      notes: schema.branch.notes,
      active: schema.branch.active,
      updatedAt: schema.branch.updatedAt,
      skuCount: sql<number>`count(${schema.branchInventory.id})::int`,
      totalUnits: sql<number>`coalesce(sum(${schema.branchInventory.quantity}), 0)::int`,
    })
    .from(schema.branch)
    .leftJoin(
      schema.branchInventory,
      and(
        eq(schema.branchInventory.branchId, schema.branch.id),
        eq(schema.branchInventory.organizationId, organizationId)
      )
    )
    .where(scoped(schema.branch.organizationId, organizationId))
    .groupBy(schema.branch.id)
    .orderBy(asc(schema.branch.name));

  return rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getBranch(organizationId: string, branchId: string) {
  const rows = await getDb()
    .select()
    .from(schema.branch)
    .where(
      scoped(
        schema.branch.organizationId,
        organizationId,
        eq(schema.branch.id, branchId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createBranch(
  organizationId: string,
  input: BranchInput
): Promise<{ id: string }> {
  const id = newId("branch");
  await getDb().insert(schema.branch).values({
    id,
    organizationId,
    name: input.name.trim(),
    address: clean(input.address),
    phone: clean(input.phone),
    notes: clean(input.notes),
    active: input.active ?? true,
  });
  return { id };
}

export async function updateBranch(
  organizationId: string,
  branchId: string,
  input: Partial<BranchInput>
): Promise<UpdateBranchResult> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.address !== undefined) set.address = clean(input.address);
  if (input.phone !== undefined) set.phone = clean(input.phone);
  if (input.notes !== undefined) set.notes = clean(input.notes);
  if (input.active !== undefined) set.active = input.active;

  const rows = await getDb()
    .update(schema.branch)
    .set(set)
    .where(
      scoped(
        schema.branch.organizationId,
        organizationId,
        eq(schema.branch.id, branchId)
      )
    )
    .returning({ id: schema.branch.id });

  if (rows.length === 0) {
    return { ok: false, code: "not_found", message: "Sucursal no encontrada" };
  }
  return { ok: true };
}

/** Borra la sucursal; sus renglones de inventario caen por FK en cascada. */
export async function deleteBranch(
  organizationId: string,
  branchId: string
): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.branch)
    .where(
      scoped(
        schema.branch.organizationId,
        organizationId,
        eq(schema.branch.id, branchId)
      )
    )
    .returning({ id: schema.branch.id });
  return rows.length > 0;
}

export async function listBranchInventory(
  organizationId: string,
  branchId: string
): Promise<BranchInventoryDto[]> {
  const rows = await getDb()
    .select({
      id: schema.branchInventory.id,
      productId: schema.catalogProduct.id,
      name: schema.catalogProduct.name,
      price: schema.catalogProduct.price,
      currency: schema.catalogProduct.currency,
      stock: schema.catalogProduct.stock,
      available: schema.catalogProduct.available,
      quantity: schema.branchInventory.quantity,
      updatedAt: schema.branchInventory.updatedAt,
    })
    .from(schema.branchInventory)
    .innerJoin(
      schema.catalogProduct,
      and(
        eq(schema.catalogProduct.id, schema.branchInventory.productId),
        eq(schema.catalogProduct.organizationId, organizationId)
      )
    )
    .where(
      scoped(
        schema.branchInventory.organizationId,
        organizationId,
        eq(schema.branchInventory.branchId, branchId)
      )
    )
    .orderBy(asc(schema.catalogProduct.name));

  return rows.map((row) => ({
    ...row,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * Enlaza el producto a la sucursal o actualiza su cantidad.
 *
 * Verifica sucursal y producto contra la organización antes del upsert: un id
 * ajeno responde 404 en vez de crear un renglón cruzado o tumbar el FK.
 */
export async function setBranchQuantity(
  organizationId: string,
  branchId: string,
  productId: string,
  quantity: number
): Promise<SetBranchQuantityResult> {
  const db = getDb();

  const branchRow = await db
    .select({ id: schema.branch.id })
    .from(schema.branch)
    .where(
      scoped(
        schema.branch.organizationId,
        organizationId,
        eq(schema.branch.id, branchId)
      )
    )
    .limit(1);
  if (branchRow.length === 0) {
    return {
      ok: false,
      code: "branch_not_found",
      message: "Sucursal no encontrada",
    };
  }

  const productRow = await db
    .select({ id: schema.catalogProduct.id })
    .from(schema.catalogProduct)
    .where(
      scoped(
        schema.catalogProduct.organizationId,
        organizationId,
        eq(schema.catalogProduct.id, productId)
      )
    )
    .limit(1);
  if (productRow.length === 0) {
    return {
      ok: false,
      code: "product_not_found",
      message: "Producto no encontrado",
    };
  }

  await db
    .insert(schema.branchInventory)
    .values({
      id: newId("branchInventory"),
      organizationId,
      branchId,
      productId,
      quantity,
    })
    .onConflictDoUpdate({
      target: [
        schema.branchInventory.branchId,
        schema.branchInventory.productId,
      ],
      set: { quantity, updatedAt: new Date() },
    });

  return { ok: true };
}

export async function removeBranchProduct(
  organizationId: string,
  branchId: string,
  productId: string
): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.branchInventory)
    .where(
      scoped(
        schema.branchInventory.organizationId,
        organizationId,
        eq(schema.branchInventory.branchId, branchId),
        eq(schema.branchInventory.productId, productId)
      )
    )
    .returning({ id: schema.branchInventory.id });
  return rows.length > 0;
}
