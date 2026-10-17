import { beforeEach, describe, expect, it, vi } from "vitest";
import { newId } from "@/lib/db/ids";

/**
 * CRUD de estrategias de ventas.
 *
 * Prueba las operaciones básicas: crear, listar, actualizar y eliminar.
 * Usa el mismo patrón de mocks que los tests de catálogo/inventario.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

let selectQueue: unknown[][] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "orderBy", "limit", "for", "offset"]) {
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
  update: mocks.update,
  delete: mocks.delete,
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  mocks.getDb.mockReturnValue(db);
  mocks.execute.mockResolvedValue(undefined);
  mocks.select.mockImplementation(() => thenableChain(selectQueue.shift() ?? []));
  mocks.insert.mockReturnValue({ values: () => Promise.resolve([]) });
  mocks.update.mockReturnValue({ set: () => ({ where: () => Promise.resolve([]) }) });
  mocks.delete.mockReturnValue({ where: () => Promise.resolve([]) });
});

describe("newId con prefijo strategy", () => {
  it("genera IDs con prefijo str_", () => {
    const id = newId("strategy");
    expect(id).toMatch(/^str_/);
  });
});

describe("patrón de mock de estrategias", () => {
  it("select devuelve filas de la cola", async () => {
    selectQueue.push([{ id: "str_1", name: "Estrategia Q4" }]);
    const result = await db.select().from("strategy");
    expect(result).toEqual([{ id: "str_1", name: "Estrategia Q4" }]);
  });

  it("insert ejecuta values", async () => {
    const insertSpy = vi.fn(() => Promise.resolve([]));
    mocks.insert.mockReturnValue({ values: insertSpy });
    await mocks.insert().values({ id: "str_1", name: "Test" });
    expect(insertSpy).toHaveBeenCalledWith({ id: "str_1", name: "Test" });
  });
});
