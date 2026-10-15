import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { createQuote, updateQuote, getQuote } from "@/server/quotes/service";

/**
 * Aislamiento multi-tenant del cotizador (Constitución III).
 *
 * Dos huecos que este archivo cierra:
 *
 *  1. `createQuote`/`updateQuote` aceptaban cualquier `productId`: el stock se
 *     "saltaba" el producto ajeno y la partida se guardaba con un FK a un
 *     producto de OTRA organización.
 *  2. `getQuote` hacía `leftJoin(catalogProduct)` SIN filtro de tenant: la
 *     descripción larga del catálogo ajeno podía filtrarse en la API y en el
 *     PDF de una cotización propia.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
  leftJoinCalls: [] as unknown[][],
  publishWebhook: vi.fn(),
}));

let selectQueue: unknown[][] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "orderBy", "limit", "for", "offset"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.where = vi.fn(() => chain);
  chain.leftJoin = vi.fn((...args: unknown[]) => {
    mocks.leftJoinCalls.push(args);
    return chain;
  });
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const db = {
  execute: mocks.execute,
  select: mocks.select,
  insert: mocks.insert,
  delete: mocks.delete,
  transaction: (work: (tx: unknown) => Promise<unknown>) => work(db),
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/webhooks/dispatcher", () => ({ publishWebhook: mocks.publishWebhook }));

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  mocks.leftJoinCalls = [];
  mocks.getDb.mockReturnValue(db);
  mocks.execute.mockResolvedValue(undefined);
  mocks.select.mockImplementation(() => thenableChain(selectQueue.shift() ?? []));
  mocks.insert.mockReturnValue({ values: () => Promise.resolve([]) });
  mocks.delete.mockReturnValue({ where: () => Promise.resolve([]) });
});

describe("productId ajeno en createQuote", () => {
  it("un producto que no existe en la organización ⇒ Producto no válido, sin insert", async () => {
    // La query scoped por org NO devuelve el producto ajeno.
    selectQueue.push([]);

    await expect(
      createQuote("org_1", {
        items: [{ productId: "cat_ajeno", name: "Ajeno", quantity: 1, unitPrice: 100 }],
      })
    ).rejects.toThrow(/Producto no válido/);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("producto propio con stock suficiente ⇒ se crea", async () => {
    selectQueue.push(
      [{ id: "cat_1", stock: 5 }],
      [{ quoteNumber: "COT-0020" }]
    );
    const id = await createQuote("org_1", {
      items: [{ productId: "cat_1", name: "Propio", quantity: 1, unitPrice: 100 }],
    });
    expect(id).toMatch(/^qt_/);
    expect(mocks.insert).toHaveBeenCalled();
  });
});

describe("productId ajeno en updateQuote", () => {
  it("rechaza partidas con producto de otra organización", async () => {
    // Orden real de queries del flujo:
    // 1) updateQuote: la cotización (FOR UPDATE)
    selectQueue.push([{ id: "qt_1", status: "draft", contactId: null }]);
    // 2) getQuote (interno): la cotización
    selectQueue.push([{ id: "qt_1", status: "draft", contactId: null, quoteNumber: "COT-0021" }]);
    // 3) getQuote: items (leftJoin)
    selectQueue.push([]);
    // 4) updateQuote: productos propios ⇒ NO devuelve el ajeno
    selectQueue.push([]);

    await expect(
      updateQuote("org_1", "qt_1", {
        items: [{ productId: "cat_ajeno", name: "Ajeno", quantity: 1, unitPrice: 100 }],
      })
    ).rejects.toThrow(/Producto no válido/);
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});

describe("el join de longDescription en getQuote", () => {
  it("incluye organizationId en la condición del leftJoin", async () => {
    selectQueue.push(
      [{ id: "qt_1", contactId: null, quoteNumber: "COT-0022" }], // la cotización
      [] // items
    );

    const quote = await getQuote("org_1", "qt_1");
    expect(quote).toBeTruthy();
    expect(mocks.leftJoinCalls).toHaveLength(1);

    const [, condition] = mocks.leftJoinCalls[0]!;
    const query = new PgDialect().sqlToQuery(condition as never);
    // Sin tenant, el join resolvía longDescription de cualquier producto con
    // el mismo id — otra organización.
    expect(query.sql).toContain('"catalog_product"."organization_id"');
    expect(query.params).toContain("org_1");
  });
});
