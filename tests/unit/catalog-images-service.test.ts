import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El servicio de fotos de producto: BD de juguete, disco de verdad.
 *
 * Lo que se fija aquí no lo puede probar una prueba pura de bytes:
 *
 *  1. La PRIMERA foto del producto nace principal. Sin eso un catálogo subido
 *     en bloque no tiene portada ni en la rejilla ni en la cotización.
 *  2. El tope se comprueba ANTES de escribir: un archivo rechazado no puede
 *     quedar en disco.
 *  3. Si la inserción falla se retira el archivo. Al revés quedaría una fila
 *     apuntando a la nada, que en pantalla es un cuadro roto permanente.
 *  4. Cambiar la principal son DOS sentencias en orden (apagar, luego encender)
 *     bajo candado: con una sola el índice único puede saltar.
 *  5. Borrar y listar siempre con el negocio puesto; el archivo sale después.
 *  6. La portada de 500 productos es UNA consulta, no 500.
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ PRODUCT_IMAGE_MAX_BYTES_MB: 2, PRODUCT_IMAGE_MAX_PER_PRODUCT: 3 }),
}));

/**
 * Estado y doble de la BD, dentro de `hoisted`: la factoría de `vi.mock` corre al
 * importar el servicio, antes de que este módulo haya inicializado sus constantes.
 */
const { state, fakeDb } = vi.hoisted(() => {
  const state = {
    selects: [] as unknown[][],
    inserts: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    executed: [] as string[],
    deletedRows: 0,
    selectCalls: 0,
    insertFails: null as Error | null,
  };

  /** Cadena thenable a lo Drizzle: todo encadena y al final resuelve. */
  function chain(resolve: unknown): Record<string, unknown> {
    const node: Record<string, unknown> = {
      from: () => node,
      where: () => node,
      limit: () => node,
      orderBy: () => node,
      then: (onOk: (v: unknown) => unknown) => Promise.resolve(resolve).then(onOk),
    };
    return node;
  }

  /** Anotado: `transaction` nombra este tipo, y sin anotación el objeto se referiría a sí mismo al inferirlo. */
  const fakeDb: Record<string, unknown> = {
    select: () => {
      state.selectCalls++;
      return chain(state.selects.shift() ?? []);
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          if (state.insertFails) throw state.insertFails;
          state.inserts.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        state.updates.push(patch);
        return chain([]);
      },
    }),
    delete: () => ({
      where: () => ({
        returning: async () =>
          state.deletedRows > 0 ? [{ storagePath: "catalog/pimg_1.png" }] : [],
      }),
    }),
    // En un `sql\`…\`` de Drizzle los literales viajan como `StringChunk` (cuyo
    // `value` es un array de trozos) y lo interpolado como valores sueltos. Se
    // reconstruye el texto con `?` en los huecos: lo que hay que comprobar es la
    // FORMA de la sentencia, no sus parámetros.
    execute: async (statement: unknown) => {
      const chunks = (statement as { queryChunks?: unknown[] })?.queryChunks ?? [];
      state.executed.push(
        chunks
          .map((chunk) => {
            const value = (chunk as { value?: unknown })?.value;
            return Array.isArray(value) ? value.join("") : "?";
          })
          .join("")
      );
      return [];
    },
    transaction: async (cb: (tx: typeof fakeDb) => Promise<unknown>) => cb(fakeDb),
  };

  return { state, fakeDb };
});

vi.mock("@/lib/db", () => ({
  getDb: () => fakeDb,
  // Columnas como texto: nada de esto llega a ejecutarse contra Postgres.
  schema: {
    productImage: {
      id: "id",
      organizationId: "organization_id",
      productId: "product_id",
      storagePath: "storage_path",
      mimeType: "mime_type",
      bytes: "bytes",
      width: "width",
      height: "height",
      altText: "alt_text",
      position: "position",
      isPrimary: "is_primary",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
    catalogProduct: { id: "id", organizationId: "organization_id" },
  },
}));

import {
  addProductImage,
  deleteProductImage,
  listProductImages,
  primaryImageFilesForChat,
  primaryImagesByProducts,
  removeProductImageFiles,
  reorderProductImages,
  setPrimaryProductImage,
} from "@/server/catalog/images";

const ORG = "org_zorro";
const PRODUCT = "cat_1";

/** PNG mínimo: firma + IHDR con 4x4. */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0,
  0, 4, 0, 0, 0, 0, 0, 0, 0, 0,
]);

let root: string;

/** El producto es del negocio y ya tiene `n` fotos. */
function productoConFotos(n: number) {
  state.selects = [[{ id: PRODUCT }], [{ n }]];
}

const filesEnCatalogo = () =>
  existsSync(join(root, ORG, "catalog")) ? readdirSync(join(root, ORG, "catalog")) : [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zorro-catalog-images-"));
  process.env.MEDIA_DIR = root;
  mkdirSync(join(root, ORG), { recursive: true });
  state.selects = [];
  state.inserts = [];
  state.updates = [];
  state.executed = [];
  state.deletedRows = 0;
  state.selectCalls = 0;
  state.insertFails = null;
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("addProductImage", () => {
  it("la primera foto del producto nace principal", async () => {
    productoConFotos(0);
    const result = await addProductImage({
      organizationId: ORG,
      productId: PRODUCT,
      userId: "user_1",
      bytes: PNG,
    });
    expect(result.ok).toBe(true);
    expect(state.inserts[0]).toMatchObject({
      isPrimary: true,
      position: 0,
      mimeType: "image/png",
      uploadedBy: "user_1",
      organizationId: ORG,
    });
    // La URL sale del prefijo `catalog`, lo único que la ruta pública admite.
    const image = (result as { image: { id: string; url: string } }).image;
    expect(image.url).toBe(`/api/media/public/${ORG}/catalog/${image.id}.png`);
    expect(filesEnCatalogo()).toEqual([`${image.id}.png`]);
    // El ancho/alto van guardados: la rejilla reserva el cajón con su proporción.
    expect(state.inserts[0]).toMatchObject({ width: 4, height: 4, bytes: PNG.length });
  });

  it("la segunda entra al final de la tira y NO roba la portada", async () => {
    productoConFotos(1);
    await addProductImage({ organizationId: ORG, productId: PRODUCT, bytes: PNG });
    expect(state.inserts[0]).toMatchObject({ isPrimary: false, position: 1 });
  });

  it("un producto inexistente o de otro negocio no deja fila ni archivo", async () => {
    state.selects = [[]];
    const result = await addProductImage({ organizationId: ORG, productId: "cat_ajeno", bytes: PNG });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(state.inserts).toHaveLength(0);
    expect(filesEnCatalogo()).toEqual([]);
  });

  it("lo que no es foto se rechaza sin tocar disco", async () => {
    productoConFotos(0);
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const result = await addProductImage({ organizationId: ORG, productId: PRODUCT, bytes: html });
    expect(result).toMatchObject({ ok: false, code: "invalid_image" });
    expect(filesEnCatalogo()).toEqual([]);
  });

  it("el tope por producto se aplica antes de escribir", async () => {
    productoConFotos(3);
    const result = await addProductImage({ organizationId: ORG, productId: PRODUCT, bytes: PNG });
    expect(result).toMatchObject({ ok: false, code: "invalid_image" });
    expect((result as { message: string }).message).toContain("3 fotos");
    expect(filesEnCatalogo()).toEqual([]);
  });

  it("si la fila no se puede insertar, el archivo se retira", async () => {
    // Al revés quedaría una fila apuntando a la nada: un cuadro roto que el
    // negocio ya no puede quitar de la rejilla.
    productoConFotos(0);
    state.insertFails = new Error("unique_violation");
    await expect(addProductImage({ organizationId: ORG, productId: PRODUCT, bytes: PNG })).rejects.toThrow();
    expect(filesEnCatalogo()).toEqual([]);
  });

  it("contar, decidir y escribir van bajo un candado por producto", async () => {
    // Dos subidas paralelas que leyeran el mismo `existingCount` dejarían una
    // foto más allá del tope.
    productoConFotos(0);
    await addProductImage({ organizationId: ORG, productId: PRODUCT, bytes: PNG });
    expect(state.executed.join(" ")).toContain("pg_advisory_xact_lock");
  });

  it("un MEDIA_DIR no escribible se avisa, no se convierte en 500", async () => {
    rmSync(join(root, ORG), { recursive: true, force: true });
    writeFileSync(join(root, ORG), "esto no es un directorio");
    productoConFotos(0);
    const result = await addProductImage({ organizationId: ORG, productId: PRODUCT, bytes: PNG });
    expect(result).toMatchObject({ ok: false, code: "invalid_image" });
    expect((result as { message: string }).message).toContain("MEDIA_DIR");
  });
});

describe("setPrimaryProductImage", () => {
  it("apaga todas las fotos del producto y luego enciende la elegida", async () => {
    // Orden obligatorio: con un solo `SET is_primary = (id = X)` Postgres puede
    // escribir la fila nueva como principal antes de desmarcar la anterior y el
    // índice único parcial revienta la operación con un 23505 falso.
    state.selects = [[{ productId: PRODUCT }]];
    expect(await setPrimaryProductImage(ORG, "pimg_2")).toEqual({ ok: true });
    expect(state.updates).toHaveLength(2);
    expect(state.updates[0]).toEqual({ isPrimary: false });
    expect(state.updates[1]).toMatchObject({ isPrimary: true });
  });

  it("una imagen de otro negocio no mueve nada", async () => {
    state.selects = [[]];
    expect(await setPrimaryProductImage(ORG, "pimg_ajena")).toMatchObject({ ok: false, code: "not_found" });
    expect(state.updates).toHaveLength(0);
  });
});

describe("reorderProductImages", () => {
  it("escribe toda la tira en UN solo UPDATE", async () => {
    await reorderProductImages(ORG, PRODUCT, ["pimg_b", "pimg_a"]);
    const updates = state.executed.filter((text) => text.includes("UPDATE"));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("CASE");
    // El candado se toma en la misma transacción, antes del UPDATE.
    expect(state.executed[0]).toContain("pg_advisory_xact_lock");
  });

  it("una tira vacía no va ni al servidor", async () => {
    await reorderProductImages(ORG, PRODUCT, []);
    expect(state.executed).toHaveLength(0);
    expect(state.selectCalls).toBe(0);
  });
});

describe("deleteProductImage", () => {
  it("si no borró fila, no toca archivo", async () => {
    state.deletedRows = 0;
    expect(await deleteProductImage(ORG, "pimg_ajena")).toMatchObject({ ok: false, code: "not_found" });
  });

  it("borra la fila del negocio y retira su archivo", async () => {
    state.deletedRows = 1;
    mkdirSync(join(root, ORG, "catalog"), { recursive: true });
    writeFileSync(join(root, ORG, "catalog", "pimg_1.png"), "foto");
    expect(await deleteProductImage(ORG, "pimg_1")).toEqual({ ok: true });
    expect(filesEnCatalogo()).toEqual([]);
  });
});

describe("removeProductImageFiles", () => {
  it("retira todas las fotos del producto que se va a borrar", async () => {
    mkdirSync(join(root, ORG, "catalog"), { recursive: true });
    writeFileSync(join(root, ORG, "catalog", "pimg_1.png"), "a");
    writeFileSync(join(root, ORG, "catalog", "pimg_2.png"), "b");
    state.selects = [[{ storagePath: "catalog/pimg_1.png" }, { storagePath: "catalog/pimg_2.png" }]];
    await removeProductImageFiles(ORG, PRODUCT);
    expect(filesEnCatalogo()).toEqual([]);
  });

  it("una ruta guardada que salga del árbol del negocio se ignora", async () => {
    state.selects = [[{ storagePath: "../secreto.txt" }]];
    writeFileSync(join(root, "secreto.txt"), "no tocar");
    await removeProductImageFiles(ORG, PRODUCT);
    expect(readFileSync(join(root, "secreto.txt"), "utf8")).toBe("no tocar");
  });
});

describe("primaryImageFilesForChat", () => {
  const cover = (over: Record<string, unknown> = {}) => ({
    id: "pimg_1",
    productId: PRODUCT,
    organizationId: ORG,
    storagePath: "catalog/pimg_1.png",
    mimeType: "image/png",
    bytes: PNG.length,
    ...over,
  });

  /** Escribe la foto en el volumen del negocio y devuelve su ruta relativa. */
  function writeCover(name = "pimg_1.png", body = PNG) {
    mkdirSync(join(root, ORG, "catalog"), { recursive: true });
    writeFileSync(join(root, ORG, "catalog", name), body);
    return `catalog/${name}`;
  }

  it("lee la portada de cada producto con un nombre legible", async () => {
    writeCover();
    writeCover("pimg_2.png", PNG);
    state.selects = [[cover(), cover({ productId: "cat_2", id: "pimg_2", storagePath: "catalog/pimg_2.png" })]];

    const { files, unreadable } = await primaryImageFilesForChat(ORG, [PRODUCT, "cat_2"]);

    expect(unreadable).toEqual([]);
    expect(Object.keys(files)).toEqual([PRODUCT, "cat_2"]);
    expect(files[PRODUCT]).toMatchObject({ mimeType: "image/png", fileName: "pimg_1.png" });
    expect([...files["cat_2"]!.data]).toEqual([...PNG]);
  });

  it("un archivo que ya no está en disco se reporta: no se manda una foto inventada", async () => {
    state.selects = [[cover()]];
    const { files, unreadable } = await primaryImageFilesForChat(ORG, [PRODUCT]);

    expect(files).toEqual({});
    expect(unreadable).toEqual([PRODUCT]);
  });

  it("una fila cuya ruta sale del árbol del negocio nunca se lee", async () => {
    // El `storage_path` lo escribe la app, pero si alguien lo manipula, la única
    // lectura posible sigue siendo el volumen del propio negocio.
    writeFileSync(join(root, "secreto.txt"), "no tocar");
    state.selects = [[cover({ storagePath: "../secreto.txt" })]];

    const { files, unreadable } = await primaryImageFilesForChat(ORG, [PRODUCT]);

    expect(files).toEqual({});
    expect(unreadable).toEqual([PRODUCT]);
    expect(readFileSync(join(root, "secreto.txt"), "utf8")).toBe("no tocar");
  });

  it("sin productos no se consulta nada", async () => {
    const { files, unreadable } = await primaryImageFilesForChat(ORG, []);

    expect(files).toEqual({});
    expect(unreadable).toEqual([]);
    expect(state.selectCalls).toBe(0);
  });
});

describe("listProductImages y portadas", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "pimg_1",
    productId: PRODUCT,
    organizationId: ORG,
    storagePath: "catalog/pimg_1.png",
    mimeType: "image/png",
    bytes: PNG.length,
    width: 4,
    height: 4,
    altText: null,
    position: 0,
    isPrimary: true,
    createdAt: new Date(0),
    ...over,
  });

  it("devuelve la tira con su URL pública", async () => {
    state.selects = [[row()]];
    const rows = await listProductImages(ORG, PRODUCT);
    expect(rows[0]).toMatchObject({
      id: "pimg_1",
      url: `/api/media/public/${ORG}/catalog/pimg_1.png`,
      isPrimary: true,
    });
  });

  it("la portada de muchos productos cuesta UNA consulta", async () => {
    state.selects = [[row(), row({ id: "pimg_9", productId: "cat_2", isPrimary: false })]];
    const out = await primaryImagesByProducts(ORG, [PRODUCT, "cat_2", "cat_3"]);
    expect(state.selectCalls).toBe(1);
    // Gana la primera fila de cada grupo; el producto sin foto no aparece.
    expect(Object.keys(out)).toEqual([PRODUCT, "cat_2"]);
    expect(out["cat_2"]!.id).toBe("pimg_9");
  });

  it("sin productos no se consulta nada", async () => {
    expect(await primaryImagesByProducts(ORG, [])).toEqual({});
    expect(state.selectCalls).toBe(0);
  });
});
