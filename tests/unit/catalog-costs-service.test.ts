import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * El servicio de recetas de costo, contra una BD de juguete.
 *
 * Aquí no se prueba dinero —eso ya se fijó en `catalog-costs-math`—, se prueban
 * las tres cosas que una base de datos de verdad castiga:
 *
 *  1. NINGUNA lectura o escritura sin el negocio en el WHERE (Constitución III).
 *     Cada cláusula se captura y se serializa con el dialecto real: lo que se
 *     comprueba es que el SQL salga con `organization_id` y su parámetro.
 *  2. La cantidad viaja como TEXTO a la columna `numeric`. Si viajara como
 *     number de JS, 0.3 se escribiría 0.29999999999999998889… y el costo saldría
 *     con centavos fantasma para siempre.
 *  3. Reemplazar es ATÓMICO: candado, borrar e insertar en la misma transacción;
 *     y si el producto no es del negocio, no se borra nada.
 */

const { state, fakeDb } = vi.hoisted(() => {
  const state = {
    /** Filas que resuelve cada `select`, en orden de llamada. */
    selects: [] as unknown[][],
    /** Cláusulas WHERE capturadas crudas; se serializan en la prueba. */
    wheres: [] as unknown[],
    inserts: [] as Record<string, unknown>[],
    deleteCount: 0,
    /** Sentencias `execute` (el candado advisory). */
    executed: [] as unknown[],
    selectCalls: 0,
  };

  function chain(resolve: unknown): Record<string, unknown> {
    const node: Record<string, unknown> = {
      from: () => node,
      where: (clause: unknown) => {
        state.wheres.push(clause);
        return node;
      },
      limit: () => node,
      orderBy: () => node,
      groupBy: () => node,
      then: (onOk: (v: unknown) => unknown) => Promise.resolve(resolve).then(onOk),
    };
    return node;
  }

  const fakeDb: Record<string, unknown> = {
    select: () => {
      state.selectCalls++;
      return chain(state.selects.shift() ?? []);
    },
    insert: () => ({
      values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        state.inserts.push(...(Array.isArray(rows) ? rows : [rows]));
        return chain([]);
      },
    }),
    delete: () => ({
      where: (clause: unknown) => {
        state.deleteCount++;
        state.wheres.push(clause);
        return chain([]);
      },
    }),
    execute: async (statement: unknown) => {
      state.executed.push(statement);
      return [];
    },
    transaction: async (cb: (tx: typeof fakeDb) => Promise<unknown>) => cb(fakeDb),
  };

  return { state, fakeDb };
});

// El schema REAL: las columnas tienen que ser columnas de Drizzle para poder
// serializar los WHERE y verificar el tenant. Solo `getDb` es de mentira.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: () => fakeDb };
});

import {
  costSummariesByProducts,
  getProductCosts,
  replaceProductCosts,
} from "@/server/catalog/costs";

const ORG = "org_zorro";
const PRODUCT = "cat_1";

const dialect = new PgDialect();

/** SQL + parámetros de la enésima cláusula WHERE capturada. */
function where(i: number): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(state.wheres[i] as never);
}

/** Toda la BD leída o escrita hasta ahora lleva el negocio. */
function expectTenantEverywhere(n: number) {
  expect(state.wheres.length).toBeGreaterThanOrEqual(n);
  for (let i = 0; i < state.wheres.length; i++) {
    const q = where(i);
    expect(q.sql).toContain("organization_id");
    expect(q.params).toContain(ORG);
  }
}

/** Fila cruda como la entrega postgres.js: `numeric` llega como TEXTO. */
function dbLine(over: Record<string, unknown> = {}) {
  return {
    id: "pcst_1",
    organizationId: ORG,
    productId: PRODUCT,
    name: "Cera de soya",
    quantity: "0.3",
    unit: "kg",
    unitPriceCents: 80_000,
    position: 0,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    ...over,
  };
}

const product = { id: PRODUCT, name: "Vela grande", price: 50_000 };

/** Secuencia de `select` para un reemplazo: tx → producto → líneas → costo plano. */
function forReplace(lines: unknown[][]) {
  state.selects = [[{ id: PRODUCT }], [product], lines, []];
}

beforeEach(() => {
  state.selects = [];
  state.wheres = [];
  state.inserts = [];
  state.deleteCount = 0;
  state.executed = [];
  state.selectCalls = 0;
});

describe("getProductCosts", () => {
  it("deriva el costo de las columnas: en la BD no hay ninguna", async () => {
    state.selects = [[product], [dbLine()], []];
    const result = await getProductCosts(ORG, PRODUCT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product).toEqual({ id: PRODUCT, name: "Vela grande", priceCents: 50_000 });
    expect(result.cost.lines[0]).toMatchObject({
      name: "Cera de soya",
      quantity: 0.3,
      costCents: 24_000,
    });
    expect(result.cost.totals.totalCostCents).toBe(24_000);
  });

  it("las tres lecturas llevan el negocio en el WHERE", async () => {
    state.selects = [[product], [dbLine()], []];
    await getProductCosts(ORG, PRODUCT);
    expectTenantEverywhere(3);
  });

  it("un producto de otro negocio es not_found, no una receta vacía", async () => {
    state.selects = [[], [], []];
    const result = await getProductCosts(ORG, "cat_de_otro");
    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });

  it("un numeric ilegible no revienta la lectura: pasa a 0", async () => {
    state.selects = [[product], [dbLine({ quantity: "abc" })], []];
    const result = await getProductCosts(ORG, PRODUCT);
    expect(result.ok && result.cost.lines[0]!.quantity).toBe(0);
  });

  it("trae el costo plano vigente de service_cost, con su ventana en SQL", async () => {
    state.selects = [[product], [], [{ costCents: 21_000 }]];
    const result = await getProductCosts(ORG, PRODUCT);
    expect(result.ok && result.flatCostCents).toBe(21_000);
    const q = where(2);
    expect(q.sql).toContain("effective_from");
    expect(q.sql).toContain("effective_to");
    expect(q.sql).toContain("catalog_product_id");
  });

  it("sin costo plano registrado: null, no 0", async () => {
    state.selects = [[product], [dbLine()], []];
    const result = await getProductCosts(ORG, PRODUCT);
    expect(result.ok && result.flatCostCents).toBe(null);
  });
});

describe("replaceProductCosts", () => {
  it("escribe la cantidad como TEXTO exacto, no como float", async () => {
    forReplace([]);
    await replaceProductCosts({
      organizationId: ORG,
      productId: PRODUCT,
      lines: [
        { name: "  Cera de soya  ", quantity: 0.3, unit: " kg ", unitPriceCents: 80_000 },
        { name: "Mecha", quantity: 2, unit: "pza", unitPriceCents: 1_500 },
      ],
    });
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts[0]!.quantity).toBe("0.3");
    expect(state.inserts[1]!.quantity).toBe("2");
    // Nombre y unidad se guardan recortados: la receta se lee en pantalla.
    expect(state.inserts[0]!.name).toBe("Cera de soya");
    expect(state.inserts[0]!.unit).toBe("kg");
    expect(state.inserts[0]!.organizationId).toBe(ORG);
    expect(state.inserts[0]!.productId).toBe(PRODUCT);
  });

  it("0.1 + 0.2 estilo: la cantidad decimal no se descompone", async () => {
    forReplace([]);
    await replaceProductCosts({
      organizationId: ORG,
      productId: PRODUCT,
      lines: [{ name: "Alcohol", quantity: 0.7, unit: "ml", unitPriceCents: 250 }],
    });
    // Un number daría "0.7" igual, pero 0.30000000000000004 al multiplicar; lo
    // que se fija es que el string escrito no traiga cola de binario.
    expect(String(state.inserts[0]!.quantity)).toBe("0.7");
    expect(state.inserts[0]!.quantity).not.toMatch(/e-|\.000000/);
  });

  it("regenera ids y posiciones en el orden recibido", async () => {
    forReplace([]);
    await replaceProductCosts({
      organizationId: ORG,
      productId: PRODUCT,
      lines: [
        { id: "pcst_vieja", name: "A", quantity: 1, unit: "g", unitPriceCents: 10 },
        { name: "B", quantity: 1, unit: "g", unitPriceCents: 10 },
      ],
    });
    expect(state.inserts.map((r) => r.position)).toEqual([0, 1]);
    expect(state.inserts.every((r) => String(r.id).startsWith("pcst_"))).toBe(true);
    // La id que envió el cliente se ignora: el reemplazo regenera todas.
    expect(state.inserts.map((r) => r.id)).not.toContain("pcst_vieja");
  });

  it("candado por producto antes de borrar", async () => {
    forReplace([]);
    await replaceProductCosts({
      organizationId: ORG,
      productId: PRODUCT,
      lines: [{ name: "A", quantity: 1, unit: "g", unitPriceCents: 10 }],
    });
    expect(state.executed).toHaveLength(1);
    const lock = dialect.sqlToQuery(state.executed[0] as never);
    expect(lock.sql).toContain("pg_advisory_xact_lock");
    expect(lock.params).toContain(`${ORG}:${PRODUCT}:product_costs`);
    expect(state.deleteCount).toBe(1);
  });

  it("lines: [] borra la receta en vez de quejarse", async () => {
    forReplace([]);
    const result = await replaceProductCosts({
      organizationId: ORG,
      productId: PRODUCT,
      lines: [],
    });
    expect(result.ok).toBe(true);
    expect(state.deleteCount).toBe(1);
    expect(state.inserts).toHaveLength(0);
  });

  it("si el producto no es del negocio, no se borra nada", async () => {
    state.selects = [[]];
    const result = await replaceProductCosts({
      organizationId: ORG,
      productId: "cat_ajeno",
      lines: [{ name: "A", quantity: 1, unit: "g", unitPriceCents: 10 }],
    });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(state.deleteCount).toBe(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("el DELETE va scoped: sin el negocio, borraría el catálogo entero", async () => {
    forReplace([]);
    await replaceProductCosts({
      organizationId: ORG,
      productId: PRODUCT,
      lines: [{ name: "A", quantity: 1, unit: "g", unitPriceCents: 10 }],
    });
    // wheres: 0 producto (tx), 1 delete, 2 producto (lectura), 3 líneas, 4 plano.
    const del = where(1);
    expect(del.sql).toContain("organization_id");
    expect(del.sql).toContain("product_id");
    expect(del.params).toContain(ORG);
    expect(del.params).toContain(PRODUCT);
  });

  it("responde lo que quedó escrito, no lo que se envió", async () => {
    // Después del commit la lectura de verificación devuelve OTRA línea: lo que
    // se responde tiene que ser lo de la BD, no el borrador del cliente.
    state.selects = [
      [{ id: PRODUCT }],
      [product],
      [dbLine({ name: "Cera real", quantity: "0.5" })],
      [],
    ];
    const result = await replaceProductCosts({
      organizationId: ORG,
      productId: PRODUCT,
      lines: [{ name: "Cera", quantity: 0.3, unit: "kg", unitPriceCents: 80_000 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost.lines.map((l) => l.name)).toEqual(["Cera real"]);
    expect(result.cost.totals.totalCostCents).toBe(40_000);
  });
});

describe("costSummariesByProducts", () => {
  it("una sola consulta para toda la rejilla", async () => {
    state.selects = [
      [
        { productId: "cat_1", lineCount: 3, totalCents: "24400" },
        { productId: "cat_2", lineCount: 1, totalCents: "1500" },
      ],
    ];
    const summaries = await costSummariesByProducts(ORG, ["cat_1", "cat_2", "cat_3"]);
    expect(state.selectCalls).toBe(1);
    expect(summaries).toEqual({
      cat_1: { totalCostCents: 24_400, lineCount: 3 },
      cat_2: { totalCostCents: 1_500, lineCount: 1 },
    });
    // Sin receta = AUSENTE, no 0: la tarjeta dice «sin registrar», no «cuesta $0».
    expect(summaries.cat_3).toBe(undefined);
  });

  it("lista vacía: ni se consulta", async () => {
    const summaries = await costSummariesByProducts(ORG, []);
    expect(state.selectCalls).toBe(0);
    expect(summaries).toEqual({});
  });

  it("el negocio va en el WHERE del agregado", async () => {
    state.selects = [[]];
    await costSummariesByProducts(ORG, ["cat_1"]);
    expectTenantEverywhere(1);
  });

  it("un sum() en texto sale en centavos enteros y seguros", async () => {
    state.selects = [[{ productId: "cat_1", lineCount: 2, totalCents: "6000000000000000" }]];
    const s = await costSummariesByProducts(ORG, ["cat_1"]);
    expect(s.cat_1!.totalCostCents).toBe(6_000_000_000_000_000);
    expect(Number.isSafeInteger(s.cat_1!.totalCostCents)).toBe(true);
  });

  it("una suma nula (sin filas) no se convierte en NaN", async () => {
    state.selects = [[{ productId: "cat_1", lineCount: 1, totalCents: null }]];
    const s = await costSummariesByProducts(ORG, ["cat_1"]);
    expect(s.cat_1).toEqual({ totalCostCents: 0, lineCount: 1 });
  });
});
