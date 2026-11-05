import { beforeEach, describe, expect, it, vi } from "vitest";
import { getQuote } from "@/server/quotes/service";

/**
 * La foto congelada sale de `getQuote` como URL, no como ruta.
 *
 * El compositor y el detalle de la cotización son navegador: no ven `MEDIA_DIR`
 * ni pueden abrir el disco, así que necesitan `/api/media/public/…`. La URL se
 * DERIVA de `quote_item.image_storage_path` en cada lectura — la ruta es lo que
 * se congeló, y seguiría apuntando al mismo archivo aunque el negocio se mueva
 * de volumen o de hosting.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  select: vi.fn(),
}));

let selectQueue: unknown[][] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "orderBy", "limit", "for", "offset", "where", "leftJoin"]) {
    chain[method] = vi.fn(() => chain);
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const db = {
  select: mocks.select,
  transaction: (work: (tx: unknown) => Promise<unknown>) => work(db),
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

const QUOTE = { id: "qt_1", contactId: null, quoteNumber: "COT-0042", organizationId: "org_1" };

const item = (over: Record<string, unknown> = {}) => ({
  item: {
    id: "qi_1",
    quoteId: "qt_1",
    productId: "cat_1",
    name: "Ramo primavera",
    quantity: 1,
    unitPrice: 35000,
    imageStoragePath: null,
    imageMimeType: null,
    imageBytes: null,
    ...over,
  },
  longDescription: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  mocks.getDb.mockReturnValue(db);
  mocks.select.mockImplementation(() => thenableChain(selectQueue.shift() ?? []));
});

async function readItems(...items: Record<string, unknown>[]) {
  selectQueue.push([QUOTE], items);
  const quote = await getQuote("org_1", "qt_1");
  return quote!.items;
}

describe("imageUrl en las partidas de la cotización", () => {
  it("sale de la ruta congelada, servida por la ruta pública del catálogo", async () => {
    const items = await readItems(
      item({ imageStoragePath: "catalog/ramo-9f3c.jpg", imageMimeType: "image/jpeg", imageBytes: 20480 })
    );

    expect(items[0]!.imageUrl).toBe("/api/media/public/org_1/catalog/ramo-9f3c.jpg");
  });

  it("una partida sin foto no inventa URL", async () => {
    const items = await readItems(item());
    expect(items[0]!.imageUrl).toBeNull();
  });

  it("la ruta guardada sigue viajando intacta: el PDF la usa tal cual", async () => {
    const items = await readItems(item({ imageStoragePath: "catalog/vieja.png" }));

    expect(items[0]!.imageStoragePath).toBe("catalog/vieja.png");
    expect(items[0]!.imageUrl).toContain("catalog/vieja.png");
  });

  it("el volumen de disco no entra en la URL: mover MEDIA_DIR no toca la fila", async () => {
    process.env.MEDIA_DIR = "/data/otro-volumen";
    try {
      const items = await readItems(item({ imageStoragePath: "catalog/ramo.jpg" }));
      expect(items[0]!.imageUrl).toBe("/api/media/public/org_1/catalog/ramo.jpg");
    } finally {
      delete process.env.MEDIA_DIR;
    }
  });

  it("la URL es de ESTE negocio, aunque la fila venga de otra org", async () => {
    // `getQuote` ya filtró la cotización por tenant; el prefijo de la URL se arma
    // con el orgId de la lectura, no con una columna que alguien pudiera editar.
    const items = await readItems(
      item({ organizationId: "org_ajena", imageStoragePath: "catalog/ajena.jpg" })
    );

    expect(items[0]!.imageUrl).toBe("/api/media/public/org_1/catalog/ajena.jpg");
  });
});
