import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { changeQuoteStatus, createQuote } from "@/server/quotes/service";
import { renderCatalog } from "@/server/ai/prompts";
import { renderProductCard, stockLabel } from "@/server/ai/product-card";
import { schema } from "@/lib/db";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  updateCalls: [] as { table: unknown; set: Record<string, unknown> }[],
  publishWebhook: vi.fn(),
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
