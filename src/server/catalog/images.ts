import { readFileSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { ProductImageDto } from "@/lib/catalog/dto";
import {
  catalogImagePath,
  catalogImageUrl,
  checkProductImageUpload,
  isProductImageMime,
  normalizeAltText,
} from "@/lib/product-images";
import { resolveMediaFile } from "@/server/media-path";

/**
 * Fotos de producto: metadatos en `product_image`, bytes en `MEDIA_DIR`.
 *
 * Nada de esto se puede hacer desde el navegador: quién es y a qué negocio
 * pertenece lo decide la sesión en la ruta, y aquí se vuelve a comprobar contra
 * la fila. La aislamiento por negocio es el mismo `scoped()` de siempre.
 */

export type ProductImageResult =
  | { ok: true; image: ProductImageDto }
  | { ok: false; code: "not_found" | "invalid_image"; message: string };

type Row = typeof schema.productImage.$inferSelect;

function toDto(row: Row): ProductImageDto {
  return {
    id: row.id,
    productId: row.productId,
    url: catalogImageUrl(row.organizationId, row.storagePath),
    mimeType: row.mimeType,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    altText: row.altText,
    position: row.position,
    isPrimary: row.isPrimary,
  };
}

/** Rutas del producto, en el orden visible. La primera sin principal es la que se pinta. */
export async function listProductImages(
  organizationId: string,
  productId: string
): Promise<ProductImageDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.productImage)
    .where(
      scoped(
        schema.productImage.organizationId,
        organizationId,
        eq(schema.productImage.productId, productId)
      )
    )
    .orderBy(asc(schema.productImage.position), asc(schema.productImage.createdAt));
  return rows.map(toDto);
}

/**
 * Foto principal de muchos productos de una vez.
 *
 * Lo necesita la rejilla del catálogo y el compositor de la cotización; hacerlo
 * por producto serían N consultas en una pantalla que ya lista 500 filas.
 * `ORDER BY is_primary DESC` dentro del grupo deja la marcada primero, y si
 * ninguna está marcada (subida antigua) gana la más antigua, que es la que se
 * veía.
 */
async function primaryRowsByProducts(
  organizationId: string,
  productIds: string[]
): Promise<Record<string, Row>> {
  const out: Record<string, Row> = {};
  if (productIds.length === 0) return out;
  const rows = await getDb()
    .select()
    .from(schema.productImage)
    .where(
      scoped(
        schema.productImage.organizationId,
        organizationId,
        inArray(schema.productImage.productId, productIds)
      )
    )
    .orderBy(
      asc(schema.productImage.productId),
      sql`${schema.productImage.isPrimary} DESC`,
      asc(schema.productImage.position),
      asc(schema.productImage.createdAt)
    );
  for (const row of rows) {
    if (!out[row.productId]) out[row.productId] = row;
  }
  return out;
}

export async function primaryImagesByProducts(
  organizationId: string,
  productIds: string[]
): Promise<Record<string, ProductImageDto>> {
  const rows = await primaryRowsByProducts(organizationId, productIds);
  const out: Record<string, ProductImageDto> = {};
  for (const [productId, row] of Object.entries(rows)) out[productId] = toDto(row);
  return out;
}

/**
 * Portadas listas para congelar en `quote_item`.
 *
 * La cotización guarda `storage_path`, no la URL: la URL lleva dentro el
 * `MEDIA_DIR` y el id del negocio, y esos dos cambian sin que cambie la foto.
 * Con la ruta relativa, el PDF de hace un año se sigue componiendo igual.
 */
export async function primaryImageSnapshots(
  organizationId: string,
  productIds: string[]
): Promise<Record<string, { storagePath: string; mimeType: string; bytes: number }>> {
  const rows = await primaryRowsByProducts(organizationId, productIds);
  const out: Record<string, { storagePath: string; mimeType: string; bytes: number }> = {};
  for (const [productId, row] of Object.entries(rows)) {
    out[productId] = { storagePath: row.storagePath, mimeType: row.mimeType, bytes: row.bytes };
  }
  return out;
}

/** Candado por producto: serializa «contar → escribir» para que el tope no se cuele. */
async function lockProductImages(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  organizationId: string,
  productId: string
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:${productId}:product_images`}))`
  );
}

/**
 * Sube una foto.
 *
 * El orden es archivo-primero, fila-después, y con borrado si la inserción
 * falla: al revés quedaría una fila apuntando a la nada, y eso en la rejilla se
 * ve como producto roto. Un archivo huérfano solo ocupa disco y se va con
 * `removeProductImageFiles`.
 */
export async function addProductImage(input: {
  organizationId: string;
  productId: string;
  userId?: string;
  bytes: Uint8Array;
  altText?: string | null;
}): Promise<ProductImageResult> {
  const db = getDb();
  const product = await db
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
  if (!product[0]) {
    return { ok: false, code: "not_found", message: "Producto no encontrado" };
  }

  const id = newId("productImage");

  // Contar, decidir y escribir van bajo el mismo candado: dos subidas paralelas
  // verían el mismo `existingCount` y dejarían una foto más allá del tope.
  return db.transaction(async (tx) => {
    await lockProductImages(tx, input.organizationId, input.productId);

    const existing = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.productImage)
      .where(
        scoped(
          schema.productImage.organizationId,
          input.organizationId,
          eq(schema.productImage.productId, input.productId)
        )
      );
    const existingCount = existing[0]?.n ?? 0;

    const checked = checkProductImageUpload(input.bytes, existingCount);
    if ("rejection" in checked) {
      return { ok: false, code: "invalid_image", message: checked.rejection.message };
    }
    if (!isProductImageMime(checked.image.mime)) {
      return { ok: false, code: "invalid_image", message: "Formato no soportado." };
    }

    const storagePath = catalogImagePath(id, checked.image.mime);
    const absolute = resolveMediaFile(input.organizationId, ...storagePath.split("/"));
    if (absolute === null) {
      return {
        ok: false,
        code: "invalid_image",
        message: "La ruta de la imagen no es válida.",
      };
    }

    try {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, input.bytes);
    } catch {
      // `MEDIA_DIR` sin montar o disco lleno: se avisa, no se deja una fila huérfana.
      return {
        ok: false,
        code: "invalid_image",
        message:
          "No se pudo guardar el archivo en el servidor. Revisa el volumen de media (MEDIA_DIR).",
      };
    }

    try {
      const row = await tx
        .insert(schema.productImage)
        .values({
          id,
          organizationId: input.organizationId,
          productId: input.productId,
          storagePath,
          mimeType: checked.image.mime,
          bytes: input.bytes.length,
          width: checked.image.width,
          height: checked.image.height,
          altText: normalizeAltText(input.altText),
          position: existingCount,
          // La primera foto del producto es la principal: sin esto, un catálogo
          // subido en bloque no tendría portada en ningún lado.
          isPrimary: existingCount === 0,
          uploadedBy: input.userId ?? null,
        })
        .returning();
      return { ok: true, image: toDto(row[0]!) };
    } catch (err) {
      await unlink(absolute).catch(() => undefined);
      throw err;
    }
  });
}

/**
 * Cambia la foto principal.
 *
 * Dos sentencias bajo candado en vez de un `SET is_primary = (id = …)`: con una
 * sola, Postgres puede escribir la fila nueva como principal antes de desmarcar
 * la anterior y el índice único parcial revienta la operación con un
 * `23505` falso. Primero se apaga todo, luego se enciende la elegida.
 */
export async function setPrimaryProductImage(
  organizationId: string,
  imageId: string
): Promise<{ ok: true } | { ok: false; code: "not_found"; message: string }> {
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ productId: schema.productImage.productId })
      .from(schema.productImage)
      .where(
        scoped(
          schema.productImage.organizationId,
          organizationId,
          eq(schema.productImage.id, imageId)
        )
      )
      .limit(1);
    const productId = rows[0]?.productId;
    if (!productId) {
      return { ok: false, code: "not_found", message: "Imagen no encontrada" } as const;
    }

    await lockProductImages(tx, organizationId, productId);
    await tx
      .update(schema.productImage)
      .set({ isPrimary: false })
      .where(
        and(
          eq(schema.productImage.productId, productId),
          eq(schema.productImage.organizationId, organizationId)
        )
      );
    await tx
      .update(schema.productImage)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(
        and(
          eq(schema.productImage.id, imageId),
          eq(schema.productImage.organizationId, organizationId)
        )
      );
    return { ok: true } as const;
  });
}

/**
 * Reordena la tira. `orderedIds` es el orden completo que ve el usuario.
 *
 * Una sola sentencia con `CASE`: el arrastre del ratón manda muchas veces y un
 * UPDATE por posición sería el mismo número de viajes al servidor. Las ids que
 * no son del negocio se quedan fuera del `WHERE` por `scoped()`, así que mover
 * una ajena no escribe nada.
 */
export async function reorderProductImages(
  organizationId: string,
  productId: string,
  orderedIds: string[]
): Promise<void> {
  if (orderedIds.length === 0) return;
  await getDb().transaction(async (tx) => {
    await lockProductImages(tx, organizationId, productId);
    const cases = orderedIds
      .map((id, index) => sql`WHEN ${id} THEN ${index}`)
      .join(" ");
    await tx.execute(sql`
      UPDATE "product_image"
         SET "position" = CASE "id" ${sql.raw(cases)} END,
             "updated_at" = now()
       WHERE "organization_id" = ${organizationId}
         AND "product_id" = ${productId}
         AND "id" IN (${sql.join(
           orderedIds.map((id) => sql`${id}`),
           sql`, `
         )})
    `);
  });
}

/** Borra una foto. El archivo sale después del commit, como en el resto de la media. */
export async function deleteProductImage(
  organizationId: string,
  imageId: string
): Promise<{ ok: true } | { ok: false; code: "not_found"; message: string }> {
  const deleted = await getDb()
    .delete(schema.productImage)
    .where(
      scoped(
        schema.productImage.organizationId,
        organizationId,
        eq(schema.productImage.id, imageId)
      )
    )
    .returning({ storagePath: schema.productImage.storagePath });

  if (deleted.length === 0) {
    return { ok: false, code: "not_found", message: "Imagen no encontrada" };
  }
  await removeFiles(organizationId, deleted.map((d) => d.storagePath));
  return { ok: true };
}

/**
 * Quita todas las fotos de un producto (se va a borrar el producto).
 *
 * Se llama después de `DELETE FROM catalog_product`, que ya borra las filas por
 * cascade: si se hiciera antes y el producto no se llegara a eliminar, el
 * catálogo quedaría sin imágenes que el negocio no pidió quitar.
 */
export async function removeProductImageFiles(
  organizationId: string,
  productId: string
): Promise<void> {
  const rows = await getDb()
    .select({ storagePath: schema.productImage.storagePath })
    .from(schema.productImage)
    .where(
      scoped(
        schema.productImage.organizationId,
        organizationId,
        eq(schema.productImage.productId, productId)
      )
    );
  await removeFiles(organizationId, rows.map((r) => r.storagePath));
}

async function removeFiles(organizationId: string, storagePaths: string[]): Promise<void> {
  for (const storagePath of storagePaths) {
    const absolute = resolveMediaFile(organizationId, ...storagePath.split("/"));
    if (absolute === null) continue;
    await unlink(absolute).catch(() => undefined);
  }
}

/** Adjunto listo para mandar por chat: bytes de la portada, tipo y nombre. */
export type ProductPhotoFile = { data: Buffer; mimeType: string; fileName: string };

/**
 * Portadas leídas del disco, para varios productos de una vez.
 *
 * Lo piden las dos salidas de una ficha con imagen: la que manda el agente en el
 * chat y la que comparte el operador desde Inventario. Es UNA consulta para todos
 * los ids y después solo lectura de archivo. `resolveMediaFile` encierra cada
 * ruta dentro de `MEDIA_DIR/{org}`, así que una fila manipulada no hace leer la
 * foto de otro negocio.
 *
 * `unreadable` trae los productos con fila de foto cuyo archivo ya no está o no
 * se puede abrir: es un fallo que hay que reportar, a diferencia de la simple
 * ausencia de fotos, que es el estado normal de un catálogo sin imágenes.
 */
export async function primaryImageFilesForChat(
  organizationId: string,
  productIds: string[]
): Promise<{ files: Record<string, ProductPhotoFile>; unreadable: string[] }> {
  const snapshots = await primaryImageSnapshots(organizationId, productIds);
  const files: Record<string, ProductPhotoFile> = {};
  const unreadable: string[] = [];
  for (const [productId, cover] of Object.entries(snapshots)) {
    const absolute = resolveMediaFile(organizationId, ...cover.storagePath.split("/"));
    let data: Buffer | null = null;
    if (absolute !== null) {
      try {
        data = readFileSync(absolute);
      } catch {
        data = null;
      }
    }
    if (data === null) {
      unreadable.push(productId);
      continue;
    }
    files[productId] = {
      data,
      mimeType: cover.mimeType,
      fileName: cover.storagePath.split("/").pop() ?? `${productId}.jpg`,
    };
  }
  return { files, unreadable };
}
