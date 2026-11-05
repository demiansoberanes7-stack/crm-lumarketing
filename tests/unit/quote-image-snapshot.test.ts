import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQuote, updateQuote } from "@/server/quotes/service";

/**
 * La foto congelada en la partida de la cotización.
 *
 * El documento ya enviado al cliente tiene que seguir viéndose igual dentro de
 * un año, aunque el producto cambie de portada o se borre del catálogo. Eso
 * solo se cumple si `quote_item` guarda SU copia de la ruta, así que lo que se
 * fija aquí es el momento de congelar y, sobre todo, que NUNCA se re-congela:
 *
 *  1. Al crear, cada partida toma la principal de su producto; lo que no tiene
 *     foto (partida escrita a mano, producto sin archivo) queda en `null`.
 *  2. Las portadas se piden UNA vez y SIN repetir producto, y se leen ANTES de
 *     abrir la transacción: dentro pediría una segunda conexión del pool
 *     mientras la transacción ya tiene una reservada.
 *  3. Al editar, la foto que ya estaba en la fila manda sobre la del catálogo,
 *     y una partida que se quedó sin foto no la recupera después.
 *  4. Solo las partidas NUEVAS que manda el llamador toman la portada actual.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  publishWebhook: vi.fn(),
  primaryImageSnapshots: vi.fn(),
}));

let selectQueue: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];
/** Orden de las lecturas: prueba que las portadas van antes del `transaction`. */
const order: string[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "orderBy", "limit", "for", "offset"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.where = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const db = {
  execute: mocks.execute,
  select: mocks.select,
  insert: mocks.insert,
  update: mocks.update,
  delete: mocks.delete,
  transaction: (work: (tx: unknown) => Promise<unknown>) => work(db),
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/webhooks/dispatcher", () => ({ publishWebhook: mocks.publishWebhook }));
vi.mock("@/server/catalog/images", () => ({
  primaryImageSnapshots: mocks.primaryImageSnapshots,
}));

/** Lo que `primaryImageSnapshots` devuelve por producto. */
const cover = (p: string, mime = "image/png", bytes = 4096) => ({
  storagePath: p,
  mimeType: mime,
  bytes,
});

/** Partida ya guardada: solo se leen las columnas que usa el servicio. */
const itemRow = (over: Record<string, unknown> = {}) => ({
  id: "qi_1",
  quoteId: "qt_1",
  productId: "cat_1",
  name: "Teclado",
  description: null,
  quantity: 1,
  unitPrice: 1000,
  position: 0,
  imageStoragePath: null,
  imageMimeType: null,
  imageBytes: null,
  ...over,
});

const QUOTE = {
  id: "qt_1",
  quoteNumber: "COT-0004",
  status: "draft",
  contactId: null,
  clientPhone: null,
  subtotal: 1000,
  discountType: null,
  discountValue: null,
  discountAmount: 0,
  taxRate: 0,
  taxAmount: 0,
  total: 1000,
  paymentMethod: null,
  validUntil: null,
  message: "nota antigua",
};

/** `items` de entrada, con precio entero para no mover los totales. */
const line = (over: Record<string, unknown> = {}) => ({
  productId: "cat_1",
  name: "Teclado",
  quantity: 1,
  unitPrice: 1000,
  ...over,
});

/**
 * Colas de selección para `createQuote`: inventario compartido de las partidas
 * y después el número siguiente (vacío → COT-0001).
 */
function queueCreate(...products: Record<string, unknown>[]) {
  selectQueue.push(products.map((p) => ({ stock: null, name: "x", id: "cat_1", ...p })), []);
}

/** Colas para `updateQuote`: FOR UPDATE, getQuote(quote + items) e inventario. */
function queueUpdate(items: Record<string, unknown>[], ...products: Record<string, unknown>[]) {
  // `getQuote` lee las partidas con el join del catálogo, así que la fila viene
  // envuelta en `{ item, longDescription }`.
  selectQueue.push(
    [QUOTE],
    [QUOTE],
    items.map((item) => ({ item, longDescription: null })),
    products.map((p) => ({ stock: null, name: "x", id: "cat_1", ...p }))
  );
}

/** Las filas insertadas que son partidas (no la cotización ni el evento). */
const lines = () => inserted.filter((v) => "unitPrice" in v);

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  inserted.length = 0;
  order.length = 0;
  mocks.getDb.mockReturnValue(db);
  mocks.execute.mockResolvedValue(undefined);
  mocks.select.mockImplementation(() => {
    order.push("select");
    return thenableChain(selectQueue.shift() ?? []);
  });
  mocks.insert.mockReturnValue({
    values: (v: Record<string, unknown>) => {
      inserted.push(v);
      return Promise.resolve([]);
    },
  });
  mocks.update.mockReturnValue({
    set: () => ({ where: () => Promise.resolve([]) }),
  });
  mocks.delete.mockReturnValue({ where: () => Promise.resolve([]) });
  mocks.primaryImageSnapshots.mockImplementation(async (_org: string, ids: string[]) => {
    order.push("covers");
    const out: Record<string, ReturnType<typeof cover>> = {};
    for (const id of ids) if (id === "cat_1" || id === "cat_3") out[id] = cover(`catalog/${id}.png`);
    return out;
  });
});

describe("createQuote: congela la portada al nacer la partida", () => {
  it("cada producto trae su foto y una partida a mano no", async () => {
    queueCreate({ id: "cat_1" }, { id: "cat_2" });
    await createQuote("org_1", {
      items: [
        line({ productId: "cat_1" }),
        line({ productId: "cat_2" }),
        line({ productId: null, name: "Mano de obra" }),
      ],
    });
    expect(lines()).toHaveLength(3);
    expect(lines()[0]).toMatchObject({
      productId: "cat_1",
      imageStoragePath: "catalog/cat_1.png",
      imageMimeType: "image/png",
      imageBytes: 4096,
    });
    // cat_2 no tiene portada en el catálogo: null, no la del vecino.
    expect(lines()[1]!.imageStoragePath).toBeNull();
    expect(lines()[1]!.imageBytes).toBeNull();
    expect(lines()[2]!.imageStoragePath).toBeNull();
  });

  it("pide las portadas una vez y sin repetir el producto", async () => {
    queueCreate({ id: "cat_1" }, { id: "cat_2" });
    await createQuote("org_1", {
      items: [
        line({ productId: "cat_1" }),
        line({ productId: "cat_1", quantity: 2 }),
        line({ productId: "cat_2" }),
      ],
    });
    expect(mocks.primaryImageSnapshots).toHaveBeenCalledTimes(1);
    expect(mocks.primaryImageSnapshots.mock.calls[0]![1]).toEqual(["cat_1", "cat_2"]);
  });

  it("lee las portadas antes de abrir la transacción", async () => {
    // Dentro de la transacción esa lectura pediría una segunda conexión del
    // pool (máximo 5) mientras la primera sigue reservada.
    queueCreate({ id: "cat_1" });
    await createQuote("org_1", { items: [line()] });
    expect(order[0]).toBe("covers");
    expect(order.slice(1)).toEqual(["select", "select"]);
  });

  it("sin partidas de catálogo no consulta fotos", async () => {
    queueCreate();
    await createQuote("org_1", { items: [line({ productId: null })] });
    expect(mocks.primaryImageSnapshots.mock.calls[0]![1]).toEqual([]);
    expect(lines()[0]!.imageStoragePath).toBeNull();
  });
});

describe("updateQuote: lo ya congelado no se re-congela", () => {
  it("una partida sin foto nueva conserva la que ya tenía", async () => {
    // El catálogo ya tiene portada para cat_1; la fila guarda la foto antigua
    // (jpeg, otros bytes). Cambiar solo las notas NO debe sustituirla: es el
    // PDF que ya vio el cliente.
    queueUpdate([itemRow({ imageStoragePath: "catalog/vieja.jpg", imageMimeType: "image/jpeg", imageBytes: 2048 })], { id: "cat_1" });
    await updateQuote("org_1", "qt_1", { notes: "revisar la entrega" });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      name: "Teclado",
      imageStoragePath: "catalog/vieja.jpg",
      imageMimeType: "image/jpeg",
      imageBytes: 2048,
    });
  });

  it("una partida que nació sin foto no la recupera del catálogo", async () => {
    queueUpdate([itemRow()], { id: "cat_1" });
    await updateQuote("org_1", "qt_1", { notes: "otra nota" });
    expect(lines()[0]!.imageStoragePath).toBeNull();
  });

  it("las partidas que manda el llamador sí toman la portada actual", async () => {
    queueUpdate([itemRow()], { id: "cat_3" });
    await updateQuote("org_1", "qt_1", { items: [line({ productId: "cat_3", name: "Monitor" })] });
    expect(mocks.primaryImageSnapshots.mock.calls[0]![1]).toEqual(["cat_3"]);
    expect(lines()[0]).toMatchObject({
      productId: "cat_3",
      imageStoragePath: "catalog/cat_3.png",
      imageBytes: 4096,
    });
  });

  it("un producto sin portada no deja ruta a medias", async () => {
    queueUpdate([itemRow()], { id: "cat_2" });
    await updateQuote("org_1", "qt_1", { items: [line({ productId: "cat_2", name: "Ratón" })] });
    expect(lines()[0]).toMatchObject({
      imageStoragePath: null,
      imageMimeType: null,
      imageBytes: null,
    });
  });
});
