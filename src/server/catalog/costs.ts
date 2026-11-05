import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  computeProductCost,
  type CostLineDraft,
  type ProductCostView,
} from "@/lib/catalog/cost";

/**
 * Receta de costos de un producto: leer, reemplazar y resumir.
 *
 * Dueño único de la escritura, como `src/server/catalog/images.ts`. La ruta
 * `/api/catalog/[id]/costs` delega aquí y el MCP no tiene su propio camino: dos
 * formas de escribir la misma receta son dos formas de que el costo total de un
 * producto dependa de por dónde se entró.
 *
 * **El costo nunca se lee de una columna.** Se saca de `quantity ×
 * unit_price_cents` con `computeProductCost`, que es la misma función que usa el
 * navegador. Aquí solo se traduce lo que dice Postgres.
 */

export type ProductCostsResult =
  | {
      ok: true;
      product: { id: string; name: string; priceCents: number };
      cost: ProductCostView;
      /** Costo plano vigente en `service_cost`, si existe. Ver `flatCostHint`. */
      flatCostCents: number | null;
    }
  | { ok: false; code: "not_found"; message: string };

/** `numeric(14,4)` llega como texto exacto; `Number` es el único paso admitido. */
function quantityOf(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Costo plano que Rentabilidad ya conoce para este producto.
 *
 * `service_cost` (0035) guarda UN número gordo por servicio con vigencia y
 * `/comercial` lo usa para el margen de contribución. La receta nueva puede dar
 * otro. No se fusionan a traición —eso cambiaría un índice que alguien está
 * leyendo en otro módulo sin que nadie lo pida—, pero tampoco se deja que el
 * negocio vea dos costos distintos sin explicación: la pantalla muestra ambos y
 * dice cuál usa Rentabilidad hoy.
 */
async function flatCostForProduct(
  organizationId: string,
  productId: string
): Promise<number | null> {
  const now = new Date();
  const rows = await getDb()
    .select({ costCents: schema.serviceCost.costCents })
    .from(schema.serviceCost)
    .where(
      and(
        scoped(schema.serviceCost.organizationId, organizationId),
        eq(schema.serviceCost.catalogProductId, productId),
        // Vigente = sin ventana, o ventana que incluye hoy.
        or(
          sql`${schema.serviceCost.effectiveFrom} is null`,
          lte(schema.serviceCost.effectiveFrom, now)
        ),
        or(sql`${schema.serviceCost.effectiveTo} is null`, lte(schema.serviceCost.effectiveTo, now))
      )
    )
    .orderBy(asc(schema.serviceCost.updatedAt))
    .limit(1);
  return rows[0]?.costCents ?? null;
}

async function productRow(organizationId: string, productId: string) {
  const rows = await getDb()
    .select({
      id: schema.catalogProduct.id,
      name: schema.catalogProduct.name,
      price: schema.catalogProduct.price,
    })
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

/** La receta completa de un producto, con totales derivados. */
export async function getProductCosts(
  organizationId: string,
  productId: string
): Promise<ProductCostsResult> {
  const product = await productRow(organizationId, productId);
  if (!product) {
    return { ok: false, code: "not_found", message: "Producto no encontrado" };
  }

  const rows = await getDb()
    .select()
    .from(schema.productCostLine)
    .where(
      scoped(
        schema.productCostLine.organizationId,
        organizationId,
        eq(schema.productCostLine.productId, productId)
      )
    )
    .orderBy(asc(schema.productCostLine.position), asc(schema.productCostLine.createdAt));

  const drafts: CostLineDraft[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    quantity: quantityOf(row.quantity),
    unit: row.unit,
    unitPriceCents: row.unitPriceCents,
  }));

  return {
    ok: true,
    product: { id: product.id, name: product.name, priceCents: product.price },
    cost: computeProductCost(product.price, drafts),
    flatCostCents: await flatCostForProduct(organizationId, productId),
  };
}

/** Candado por producto: serializa el reemplazo para que dos ediciones no se pisen. */
async function lockCostLines(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  organizationId: string,
  productId: string
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:${productId}:product_costs`}))`
  );
}

export type ReplaceCostsResult =
  | { ok: true; cost: ProductCostView; flatCostCents: number | null }
  | { ok: false; code: "not_found"; message: string };

/**
 * Reemplaza la receta entera.
 *
 * `PUT` con lista completa, y no POST/PATCH/DELETE por línea, por dos razones:
 * el margen y el % de mezcla solo tienen sentido sobre el conjunto, así que la
 * operación atómica que el usuario ve es «esta es la receta»; y con tres rutas
 * habría tres validaciones que mantener de acuerdo entre sí.
 *
 * Borrar e insertar es deliberado: se regeneran las ids y las posiciones. No hay
 * nada apuntando a una línea de costo, así que el churn de ids no rompe nada y
 * ahorra el diff. La lectura de verificación va DESPUÉS del commit y no dentro
 * de la transacción a propósito: `RETURNING` no garantiza el orden de las filas,
 * y el orden aquí es el que ve el negocio.
 */
export async function replaceProductCosts(input: {
  organizationId: string;
  productId: string;
  lines: readonly CostLineDraft[];
}): Promise<ReplaceCostsResult> {
  const missing = await getDb().transaction(async (tx) => {
    const products = await tx
      .select({ id: schema.catalogProduct.id })
      .from(schema.catalogProduct)
      .where(
        scoped(
          schema.catalogProduct.organizationId,
          input.organizationId,
          eq(schema.catalogProduct.id, input.productId)
        )
      )
      .limit(1);
    if (!products[0]) return true;

    await lockCostLines(tx, input.organizationId, products[0].id);
    await tx
      .delete(schema.productCostLine)
      .where(
        scoped(
          schema.productCostLine.organizationId,
          input.organizationId,
          eq(schema.productCostLine.productId, input.productId)
        )
      );

    if (input.lines.length > 0) {
      await tx.insert(schema.productCostLine).values(
        input.lines.map((line, index) => ({
          id: newId("productCostLine"),
          organizationId: input.organizationId,
          productId: input.productId,
          name: line.name.trim(),
          // `String`, no un número: `numeric(14,4)` es exacto y un float de JS
          // escribiría 0.3 como 0.29999999999999998889776975374843…
          quantity: String(line.quantity),
          unit: line.unit.trim(),
          unitPriceCents: line.unitPriceCents,
          position: index,
        }))
      );
    }
    return false;
  });

  if (missing) {
    return { ok: false, code: "not_found", message: "Producto no encontrado" };
  }

  // Se responde lo que quedó escrito, con la misma cuenta de la lectura normal.
  const result = await getProductCosts(input.organizationId, input.productId);
  if (!result.ok) return result;
  return { ok: true, cost: result.cost, flatCostCents: result.flatCostCents };
}

export type ProductCostSummary = { totalCostCents: number; lineCount: number };

/**
 * Costo total de muchos productos en una consulta.
 *
 * La rejilla de Inventario lista hasta 500 filas; resolver la receta producto a
 * producto serían 500 viajes, el mismo error que `primaryImagesByProducts` ya
 * cerró para las fotos. El redondeo se hace en SQL con `ROUND` sobre `numeric`
 * (exacto) y no en JS: así el número que agrupa Postgres es el mismo que la
 * línea individual del detalle, no una suma de fracciones que luego redondea
 * distinto.
 *
 * Un producto sin receta no aparece en el mapa: eso es "sin costos registrados",
 * no "cuesta 0", y la UI los distingue.
 */
export async function costSummariesByProducts(
  organizationId: string,
  productIds: string[]
): Promise<Record<string, ProductCostSummary>> {
  const out: Record<string, ProductCostSummary> = {};
  if (productIds.length === 0) return out;

  const rows = await getDb()
    .select({
      productId: schema.productCostLine.productId,
      lineCount: sql<number>`count(*)::int`,
      totalCents: sql<string>`sum(round(${schema.productCostLine.quantity} * ${schema.productCostLine.unitPriceCents}))`,
    })
    .from(schema.productCostLine)
    .where(scoped(schema.productCostLine.organizationId, organizationId))
    .groupBy(schema.productCostLine.productId);

  for (const row of rows) {
    out[row.productId] = {
      totalCostCents: Number(row.totalCents ?? 0) || 0,
      lineCount: row.lineCount,
    };
  }
  return out;
}
