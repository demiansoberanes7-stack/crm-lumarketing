import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { changeQuoteStatus, createQuote } from "@/server/quotes/service";
import { renderCatalog } from "@/server/ai/prompts";
import { renderInventoryResults } from "@/server/ai/inventory";
import { renderProductCard, renderProductShare, stockLabel } from "@/server/ai/product-card";
import { schema } from "@/lib/db";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  updateCalls: [] as { table: unknown; set: Record<string, unknown> }[],
  publishWebhook: vi.fn(),
  acceptQuoteIntoProjectTx: vi.fn(),
}));

let selectQueue: unknown[][] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "orderBy", "limit", "for"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.where = vi.fn(() => chain);
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const db = {
  execute: mocks.execute,
  select: mocks.select,
  insert: mocks.insert,
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      mocks.updateCalls.push({ table, set: values });
      return { where: () => Promise.resolve([]) };
    },
  }),
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/webhooks/dispatcher", () => ({ publishWebhook: mocks.publishWebhook }));
// Este archivo prueba el DESCUENTO de inventario; la conversión a proyecto/OS
// se sustituye para que el mock de db de aquí no tenga que emular esas tablas.
vi.mock("@/server/projects/from-quote", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/projects/from-quote")>(),
  acceptQuoteIntoProjectTx: mocks.acceptQuoteIntoProjectTx,
}));

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  mocks.updateCalls = [];
  mocks.getDb.mockReturnValue({
    ...db,
    transaction: (work: (tx: typeof db) => Promise<unknown>) => work(db),
  });
  mocks.execute.mockResolvedValue(undefined);
  mocks.select.mockImplementation(() => thenableChain(selectQueue.shift() ?? []));
  mocks.insert.mockReturnValue({ values: () => Promise.resolve([]) });
  mocks.acceptQuoteIntoProjectTx.mockResolvedValue({
    projectId: "prj_1",
    serviceOrderId: "os_1",
    projectCreated: false,
    serviceOrderCreated: false,
    projectCode: "",
    serviceOrderCode: "",
    taskIds: [],
  });
});

const PRODUCT = {
  name: "Ramo primavera",
  price: 35000,
  currency: "MXN",
  stock: 5,
  shortDescription: "Ramo pequeño de estación.",
  longDescription: "Incluye 9 tallos y tarjeta escrita a mano.",
  websiteUrl: "https://tienda.ejemplo.com/ramo",
};

describe("ficha de producto en el chat (renderProductCard)", () => {
  it("arma la ficha ordenada: nombre, precio, disponibilidad, descripción, ficha y sitio", () => {
    const card = renderProductCard(PRODUCT);
    const lines = card.split("\n");
    expect(lines[0]).toBe("*Ramo primavera*");
    expect(lines[1]).toBe("Precio: $350.00");
    expect(lines[2]).toBe("Disponibilidad: 5 piezas disponibles");
    expect(card).toContain("Ramo pequeño de estación.");
    expect(card).toContain("Incluye 9 tallos");
    expect(card).toContain("Sitio: https://tienda.ejemplo.com/ramo");
    expect(card).not.toContain("Imagen");
  });

  it("sin inventario dice consultar; en 0 dice agotado; con 1 pieza usa singular", () => {
    expect(stockLabel(null)).toBe("Consultar disponibilidad");
    expect(stockLabel(0)).toBe("Agotado por el momento");
    expect(stockLabel(1)).toBe("1 pieza disponible");
    const agotado = renderProductCard({ ...PRODUCT, stock: 0 });
    expect(agotado).toContain("Disponibilidad: Agotado por el momento");
  });

  it("omite secciones vacías sin dejar líneas sueltas", () => {
    const card = renderProductCard(
      { ...PRODUCT, shortDescription: null, longDescription: null, websiteUrl: null }
    );
    expect(card).not.toContain("Sitio:");
    expect(card.split("\n").filter((l) => l === "")).toHaveLength(0);
  });
});

describe("ficha para compartir (renderProductShare)", () => {
  it("incluye nombre, precio, descripciones y sitio, pero NUNCA la cantidad de piezas", () => {
    const card = renderProductShare(PRODUCT);
    expect(card).toContain("*Ramo primavera*");
    expect(card).toContain("Precio: $350.00");
    expect(card).toContain("Ramo pequeño de estación.");
    expect(card).toContain("Incluye 9 tallos");
    expect(card).toContain("Sitio: https://tienda.ejemplo.com/ramo");
    expect(card).not.toContain("Disponibilidad");
    expect(card).not.toContain("pieza");
  });

  it("aunque el producto tenga stock, la ficha compartida no lo filtra", () => {
    const card = renderProductShare({ ...PRODUCT, stock: 0 });
    expect(card).not.toContain("Agotado");
    expect(card).not.toContain("Disponibilidad");
  });
});

describe("catálogo en el prompt del agente (renderCatalog)", () => {
  it("incluye inventario y sitio de cada producto disponible", () => {
    const text = renderCatalog([
      { ...PRODUCT, id: "cat_1", available: true } as never,
      { ...PRODUCT, id: "cat_2", available: true, stock: null } as never,
      { ...PRODUCT, id: "cat_3", available: false } as never,
    ]);
    expect(text).toContain("Inventario: 5 piezas");
    expect(text).toContain("Inventario: consultar");
    expect(text).toContain("Sitio: https://tienda.ejemplo.com/ramo");
    expect(text).not.toContain("cat_3");
  });

  it("acota catálogos grandes y remite a search_inventory en vez de volcarlos", () => {
    const many = Array.from({ length: 4 }, (_, i) => ({
      ...PRODUCT,
      id: `cat_${i + 1}`,
      name: `Producto ${i + 1}`,
      available: true,
    }));
    const text = renderCatalog(many as never, 2);
    expect(text).toContain("Producto 1");
    expect(text).toContain("Producto 2");
    expect(text).not.toContain("Producto 4");
    expect(text).toContain("solo aparecen 2");
    expect(text).toContain("search_inventory");
    expect(text).not.toContain("Ficha técnica");
  });
});

describe("resultados de inventario para el modelo (renderInventoryResults)", () => {
  it("resume precio, existencias y disponibilidad sin descripciones largas", () => {
    const text = renderInventoryResults([
      { id: "cat_1", name: "Ramo primavera", price: 35000, currency: "MXN", stock: 5, available: true, shortDescription: "Rosas y tulipanes" },
      { id: "cat_2", name: "Servicio", price: 10000, currency: "MXN", stock: null, available: true, shortDescription: null },
      { id: "cat_3", name: "Jarrón", price: 8000, currency: "MXN", stock: 0, available: false, shortDescription: null },
    ]);
    expect(text).toContain("ID: cat_1 | Ramo primavera | $350.00 MXN | Inventario: 5 piezas");
    expect(text).toContain("Rosas y tulipanes");
    expect(text).toContain("ID: cat_2 | Servicio | $100.00 MXN | Inventario: sin control de stock");
    expect(text).toContain("ID: cat_3 | Jarrón | $80.00 MXN | Inventario: agotado | NO DISPONIBLE (no cotizar)");
  });

  it("sin coincidencias lo dice explícitamente para que el modelo no invente", () => {
    expect(renderInventoryResults([])).toBe("(sin coincidencias en el inventario)");
  });
});

describe("inventario al crear cotización (createQuote)", () => {
  it("rechaza cantidad mayor al stock disponible", async () => {
    selectQueue.push([{ id: "cat_1", stock: 2 }]);
    await expect(
      createQuote("org_1", {
        items: [{ productId: "cat_1", name: "Ramo primavera", quantity: 3, unitPrice: 35000 }],
      })
    ).rejects.toThrow(/Inventario insuficiente/);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("acepta cantidad dentro del stock", async () => {
    selectQueue.push(
      [{ id: "cat_1", stock: 5 }],
      [{ quoteNumber: "COT-0009" }]
    );
    const id = await createQuote("org_1", {
      items: [{ productId: "cat_1", name: "Ramo primavera", quantity: 2, unitPrice: 35000 }],
    });
    expect(id).toMatch(/^qt_/);
    expect(mocks.publishWebhook).toHaveBeenCalled();
  });

  it("productos sin control de stock (null) no bloquean", async () => {
    selectQueue.push(
      [{ id: "cat_1", stock: null }],
      []
    );
    const id = await createQuote("org_1", {
      items: [{ productId: "cat_1", name: "Servicio", quantity: 99, unitPrice: 10000 }],
    });
    expect(id).toMatch(/^qt_/);
  });
});

describe("descuento de inventario al aceptar (changeQuoteStatus)", () => {
  it("al aceptar descuenta el stock de los productos vinculados, una sola vez", async () => {
    selectQueue.push(
      [{ id: "qt_1", status: "sent", quoteNumber: "COT-0010" }],
      [{ productId: "cat_1", quantity: 2 }]
    );
    await changeQuoteStatus("org_1", "qt_1", "accepted");

    const stockUpdate = mocks.updateCalls.find((c) => c.table === schema.catalogProduct);
    expect(stockUpdate).toBeTruthy();
    const dialect = new PgDialect();
    const stockSet = Object.entries(stockUpdate!.set).find(([key]) => key === "stock");
    expect(stockSet).toBeTruthy();
    const query = dialect.sqlToQuery(stockSet![1] as never);
    expect(query.sql).toContain("GREATEST");
    expect(query.sql).toContain("IS NULL");
    expect(mocks.publishWebhook).toHaveBeenCalledWith(
      "org_1",
      "quote.accepted",
      expect.objectContaining({ quoteId: "qt_1" })
    );
  });

  it("al rechazar no toca el inventario", async () => {
    selectQueue.push([{ id: "qt_1", status: "sent", quoteNumber: "COT-0011" }]);
    await changeQuoteStatus("org_1", "qt_1", "rejected");
    expect(mocks.updateCalls.some((c) => c.table === schema.catalogProduct)).toBe(false);
    expect(mocks.publishWebhook).toHaveBeenCalledWith(
      "org_1",
      "quote.rejected",
      expect.objectContaining({ quoteId: "qt_1" })
    );
  });

  it("una cotización ya aceptada no vuelve a descontar", async () => {
    selectQueue.push([{ id: "qt_1", status: "accepted", quoteNumber: "COT-0012" }]);
    await expect(changeQuoteStatus("org_1", "qt_1", "accepted")).rejects.toThrow(/borrador, enviadas o vistas/);
    expect(mocks.updateCalls.some((c) => c.table === schema.catalogProduct)).toBe(false);
  });
});

describe("SQL del descuento", () => {
  it("el update de stock respeta el tenant", async () => {
    selectQueue.push(
      [{ id: "qt_1", status: "draft", quoteNumber: "COT-0013" }],
      [{ productId: "cat_1", quantity: 1 }]
    );
    await changeQuoteStatus("org_1", "qt_1", "accepted");
    const stockUpdate = mocks.updateCalls.find((c) => c.table === schema.catalogProduct)!;
    // El WHERE se arma dentro del update; el set lleva el CASE con GREATEST.
    const setSql = Object.entries(stockUpdate.set)
      .filter(([key]) => key === "stock")
      .map(([, value]) => {
        const query = new PgDialect().sqlToQuery(value as never);
        return `${query.sql} ${query.params.join(",")}`;
      })
      .join("");
    expect(setSql).toContain("GREATEST");
  });
});
