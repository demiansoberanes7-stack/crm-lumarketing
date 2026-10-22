import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { branchQuantitySchema, BRANCH_QUANTITY_MAX } from "@/lib/branch-schema";
import {
  deleteBranch,
  removeBranchProduct,
  setBranchQuantity,
} from "@/server/branches/service";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}));

const writes = vi.hoisted(() => ({
  inserts: [] as {
    table: unknown;
    values: Record<string, unknown>;
    conflict: { target: { name: string }[]; set: Record<string, unknown> };
  }[],
  where: [] as unknown[],
}));

let selectQueue: unknown[][] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "orderBy", "groupBy"]) {
    chain[method] = vi.fn(() => chain);
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

mocks.select.mockImplementation(() => thenableChain(selectQueue.shift() ?? []));
mocks.insert.mockImplementation((table: unknown) => ({
  values: (values: Record<string, unknown>) => ({
    onConflictDoUpdate: (conflict: {
      target: { name: string }[];
      set: Record<string, unknown>;
    }) => {
      writes.inserts.push({ table, values, conflict });
      return Promise.resolve();
    },
  }),
}));
mocks.delete.mockImplementation(() => ({
  where: (whereSql: unknown) => ({
    returning: () => {
      writes.where.push(whereSql);
      return Promise.resolve([{ id: "row_1" }]);
    },
  }),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));

beforeEach(() => {
  mocks.getDb.mockReturnValue({
    select: mocks.select,
    insert: mocks.insert,
    delete: mocks.delete,
  });
  selectQueue = [];
  writes.inserts = [];
  writes.where = [];
});

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const leer = (...rel: string[]) => readFileSync(path.join(RAIZ, ...rel), "utf8");

describe("cantidad por sucursal", () => {
  it("acepta enteros de 0 al tope", () => {
    expect(branchQuantitySchema.safeParse(0).success).toBe(true);
    expect(branchQuantitySchema.safeParse(1).success).toBe(true);
    expect(branchQuantitySchema.safeParse(BRANCH_QUANTITY_MAX).success).toBe(true);
  });

  it("rechaza negativos, fracciones, el tope+1 y texto", () => {
    expect(branchQuantitySchema.safeParse(-1).success).toBe(false);
    expect(branchQuantitySchema.safeParse(1.5).success).toBe(false);
    expect(branchQuantitySchema.safeParse(BRANCH_QUANTITY_MAX + 1).success).toBe(false);
    expect(branchQuantitySchema.safeParse("3").success).toBe(false);
  });
});

describe("setBranchQuantity", () => {
  it("no escribe si la sucursal no es de la organización", async () => {
    selectQueue.push([]);

    const result = await setBranchQuantity("org_1", "br_ajena", "cat_1", 3);

    expect(result).toEqual({
      ok: false,
      code: "branch_not_found",
      message: "Sucursal no encontrada",
    });
    expect(writes.inserts).toHaveLength(0);
  });

  it("no escribe si el producto no es de la organización", async () => {
    selectQueue.push([{ id: "br_1" }], []);

    const result = await setBranchQuantity("org_1", "br_1", "cat_ajeno", 3);

    expect(result).toEqual({
      ok: false,
      code: "product_not_found",
      message: "Producto no encontrado",
    });
    expect(writes.inserts).toHaveLength(0);
  });

  it("hace upsert por sucursal+producto con la organización en el alta", async () => {
    selectQueue.push([{ id: "br_1" }], [{ id: "cat_1" }]);

    const result = await setBranchQuantity("org_1", "br_1", "cat_1", 7);

    expect(result).toEqual({ ok: true });
    expect(writes.inserts).toHaveLength(1);
    const [write] = writes.inserts;
    expect(write?.values).toMatchObject({
      organizationId: "org_1",
      branchId: "br_1",
      productId: "cat_1",
      quantity: 7,
    });
    expect(String(write?.values.id)).toMatch(/^bri_/);
    expect(write?.conflict.target.map((column) => column.name)).toEqual([
      "branch_id",
      "product_id",
    ]);
    expect(write?.conflict.set.quantity).toBe(7);
    expect(write?.conflict.set.updatedAt).toBeInstanceOf(Date);
  });
});

describe("borrado scopeado por organización", () => {
  it("deleteBranch filtra por organización y sucursal", async () => {
    const ok = await deleteBranch("org_1", "br_1");

    expect(ok).toBe(true);
    const query = new PgDialect().sqlToQuery(writes.where[0] as never);
    expect(query.sql).toContain('"branch"."organization_id"');
    expect(query.sql).toContain('"branch"."id"');
    expect(query.params).toEqual(["org_1", "br_1"]);
  });

  it("removeBranchProduct filtra por organización, sucursal y producto", async () => {
    const ok = await removeBranchProduct("org_1", "br_1", "cat_1");

    expect(ok).toBe(true);
    const query = new PgDialect().sqlToQuery(writes.where[0] as never);
    expect(query.sql).toContain('"branch_inventory"."organization_id"');
    expect(query.params).toEqual(["org_1", "br_1", "cat_1"]);
  });
});

describe("superficie del módulo", () => {
  it("todas las rutas de /api/branches exigen sesión", () => {
    const rutas = [
      ["src", "app", "api", "branches", "route.ts"],
      ["src", "app", "api", "branches", "[id]", "route.ts"],
      ["src", "app", "api", "branches", "[id]", "inventory", "route.ts"],
    ];
    for (const ruta of rutas) {
      const fuente = leer(...ruta);
      const handlers = fuente.match(/export const (?:GET|POST|PATCH|PUT|DELETE) = .+/g) ?? [];
      expect(handlers.length, `${ruta.join("/")} no exporta handlers`).toBeGreaterThan(0);
      for (const handler of handlers) {
        expect(handler).toContain("withAuth(");
      }
    }
  });

  it("el servicio scopea sucursal e inventario por organización", () => {
    const fuente = leer("src", "server", "branches", "service.ts");
    expect(fuente).toMatch(/scoped\(\s*schema\.branch\.organizationId/);
    expect(fuente).toMatch(/scoped\(\s*schema\.branchInventory\.organizationId/);
  });

  it("Sucursales está en el menú, junto a Inventario", () => {
    const nav = leer("src", "config", "nav.ts");
    expect(nav).toContain('{ href: "/branches", label: "Sucursales", icon: Store }');
  });
});
