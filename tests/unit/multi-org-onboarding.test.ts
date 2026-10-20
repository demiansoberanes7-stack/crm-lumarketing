import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-negocio en una misma instancia.
 *
 * Antes, registrar una segunda cuenta estaba bloqueado (FR-060) y el único
 * camino para otro negocio era levantar otra instancia. Con `ALLOW_SIGNUP=true`
 * el alta sí pasaba, pero `onUserCreated` sembraba solo en instancia vacía: el
 * segundo usuario quedaba sin organización y rebotaba /login → /inbox → /login.
 * Aquí se fija el comportamiento nuevo: cada cuenta recibe SU negocio con su
 * configuración y nadie hereda la del vecino.
 */

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

import { schema } from "@/lib/db";
import { DEFAULT_BRANDING } from "@/lib/branding";
import { isPublicSignupAllowed } from "@/server/auth/registration";
import { getBrandingContext } from "@/server/branding";
import {
  isInstanceOwner,
  onUserCreated,
  provisionOrganization,
  slugifyOrganizationName,
} from "@/server/auth/on-signup";
import { resetInstanceOrgCache, resolveInstanceOrg } from "@/server/bot/auth";
import { pickUnambiguousOrgRow } from "@/server/zernio/account-ref";

/** Falso de Drizzle: `select` saca filas de una cola; `insert` las registra. */
let selectQueue: unknown[][] = [];
let inserts: { table: unknown; values: unknown }[] = [];
let executed: unknown[] = [];

function selectChain() {
  const box: Record<string, unknown> = {};
  for (const method of ["from", "where", "innerJoin", "leftJoin", "groupBy", "orderBy"]) {
    box[method] = () => box;
  }
  box.limit = () => Promise.resolve(selectQueue.shift() ?? []);
  box.then = (resolve: (value: unknown) => void) =>
    Promise.resolve(selectQueue.shift() ?? []).then(resolve);
  return box;
}

/**
 * Cadena de `insert`: awaitable y con los encadenados que usan los sembrados
 * (`onConflictDoNothing`, `returning`) para que el falso no se rompa cuando el
 * negocio nace con más configuración.
 */
function insertResult(values: unknown) {
  const rows = Array.isArray(values) ? values : [values];
  const result = Promise.resolve(rows) as Promise<unknown> & {
    onConflictDoNothing: () => Promise<unknown>;
    returning: () => Promise<unknown[]>;
  };
  result.onConflictDoNothing = () => result;
  result.returning = () => Promise.resolve(rows as unknown[]);
  return result;
}

function fakeDb() {
  const db: Record<string, unknown> = {
    select: () => selectChain(),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return insertResult(values);
      },
    }),
    execute: (statement: unknown) => {
      executed.push(statement);
      return Promise.resolve([]);
    },
  };
  db.transaction = (cb: (tx: unknown) => Promise<unknown>) => cb(db);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  inserts = [];
  executed = [];
  mocks.getDb.mockImplementation(fakeDb);
});

afterEach(() => vi.unstubAllEnvs());

function rowsInsertedInto(table: unknown): Record<string, unknown>[] {
  const values = inserts.find((i) => i.table === table)?.values;
  if (!values) return [];
  return (Array.isArray(values) ? values : [values]) as Record<string, unknown>[];
}

describe("slugifyOrganizationName", () => {
  it("quita acentos y espacios sin dejar hueco ni guiones sueltos", () => {
    expect(slugifyOrganizationName("  Peluquería  El “Aurora” ")).toBe(
      "peluqueria-el-aurora"
    );
  });

  it("un nombre sin letras ni dígitos útiles sigue dando slug", () => {
    expect(slugifyOrganizationName("¡¿¡¿! · «La Esquina»")).toBe("la-esquina");
    expect(slugifyOrganizationName("   ")).toBe("negocio");
  });
});

describe("provisionOrganization", () => {
  it("un nombre demasiado corto no crea nada", async () => {
    await expect(provisionOrganization("u_1", " A ")).resolves.toMatchObject({
      ok: false,
    });
    expect(inserts).toHaveLength(0);
  });

  it("un usuario que ya tiene negocio no recibe un segundo tenant", async () => {
    selectQueue.push([{ organizationId: "org_ya_existe" }]);
    await expect(provisionOrganization("u_1", "Peluquería Aurora")).resolves.toEqual({
      ok: true,
      organizationId: "org_ya_existe",
      created: false,
    });
    expect(inserts).toHaveLength(0);
  });

  it("crea organización, membresía owner y la configuración del negocio", async () => {
    selectQueue.push([], []); // sin membresía · slug libre
    const outcome = await provisionOrganization("u_2", "  Peluquería Aurora  ");
    expect(outcome).toMatchObject({ ok: true, created: true });

    const organizationId = (outcome as { organizationId: string }).organizationId;
    expect(rowsInsertedInto(schema.organization)[0]).toMatchObject({
      id: organizationId,
      name: "Peluquería Aurora",
      slug: "peluqueria-aurora",
    });
    expect(rowsInsertedInto(schema.member)[0]).toMatchObject({
      organizationId,
      userId: "u_2",
      role: "owner",
    });

    // La promesa de aislamiento: TODA fila sembrada nace con su organization_id.
    for (const table of [
      schema.pipelineStage,
      schema.acquisitionChannel,
      schema.lossReasonCatalog,
      schema.agentProfile,
      schema.projectTemplate,
    ]) {
      const rows = rowsInsertedInto(table);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.organizationId === organizationId)).toBe(true);
    }
    expect(rowsInsertedInto(schema.pipelineStage)).toHaveLength(6);
  });

  it("el slug repetido pasa al siguiente candidato", async () => {
    selectQueue.push([], [{ id: "otro" }], []);
    await provisionOrganization("u_3", "Peluquería Aurora");
    expect(rowsInsertedInto(schema.organization)[0]).toMatchObject({
      slug: "peluqueria-aurora-2",
    });
  });

  it("dos altas simultáneas del mismo usuario se serializan con un lock", async () => {
    selectQueue.push([], []);
    await provisionOrganization("u_4", "Café Luna");
    expect(executed).toHaveLength(1);
  });
});

describe("onUserCreated (solo el primer arranque)", () => {
  it("instancia con organización ya creada → no inserta nada", async () => {
    selectQueue.push([{ n: 1 }]);
    await onUserCreated("u_segundo", "Segundo");
    expect(inserts).toHaveLength(0);
  });

  it("instancia vacía → negocio con slug 'principal', owner y sembrado", async () => {
    selectQueue.push([{ n: 0 }]);
    await onUserCreated("u_primero", "Ana");
    expect(rowsInsertedInto(schema.organization)[0]).toMatchObject({
      name: "Negocio de Ana",
      slug: "principal",
    });
    expect(rowsInsertedInto(schema.member)[0]).toMatchObject({ role: "owner" });
    expect(rowsInsertedInto(schema.pipelineStage)).toHaveLength(6);
  });

  it("sin nombre de usuario, el negocio se llama 'Mi negocio'", async () => {
    selectQueue.push([{ n: 0 }]);
    await onUserCreated("u_primero", "");
    expect(rowsInsertedInto(schema.organization)[0]).toMatchObject({
      name: "Mi negocio",
    });
  });
});

describe("isInstanceOwner", () => {
  it("es el owner de la organización más antigua", async () => {
    selectQueue.push([{ ownerOfFirst: "u_ana" }]);
    await expect(isInstanceOwner("u_ana")).resolves.toBe(true);
  });

  it("un owner de negocio posterior no puede abrir tenants", async () => {
    selectQueue.push([{ ownerOfFirst: "u_ana" }]);
    await expect(isInstanceOwner("u_cliente")).resolves.toBe(false);
  });

  it("sin ninguna organización no hay operador", async () => {
    selectQueue.push([]);
    await expect(isInstanceOwner("u_ana")).resolves.toBe(false);
  });
});

describe("marca en páginas públicas", () => {
  it("una sola organización → su marca", async () => {
    selectQueue.push([
      { id: "org_1", metadata: JSON.stringify({ branding: { name: "Aurora" } }) },
    ]);
    const ctx = await getBrandingContext(null);
    expect(ctx.organizationId).toBe("org_1");
  });

  it("varias organizaciones → marca neutra, ningún cliente expuesto en el login", async () => {
    selectQueue.push([
      { id: "org_1", metadata: null },
      { id: "org_2", metadata: null },
    ]);
    await expect(getBrandingContext(null)).resolves.toEqual({
      organizationId: null,
      branding: DEFAULT_BRANDING,
    });
  });

  it("con organización explícita se usa esa aunque haya varias", async () => {
    selectQueue.push([
      { id: "org_2", metadata: JSON.stringify({ branding: { name: "Aurora" } }) },
    ]);
    const ctx = await getBrandingContext("org_2");
    expect(ctx.organizationId).toBe("org_2");
    expect(ctx.branding.name).toBe("Aurora");
  });
});

describe("gate de registro (FR-060 intacto)", () => {
  it("con organizaciones y sin escape sigue cerrado", async () => {
    selectQueue.push([{ n: 3 }]);
    vi.stubEnv("ALLOW_SIGNUP", "");
    await expect(isPublicSignupAllowed()).resolves.toBe(false);
  });

  it("ALLOW_SIGNUP=true lo abre para el alta pública de negocios", async () => {
    selectQueue.push([{ n: 3 }]);
    vi.stubEnv("ALLOW_SIGNUP", "true");
    await expect(isPublicSignupAllowed()).resolves.toBe(true);
  });
});

describe("el cerebro externo no adivina el tenant", () => {
  it("sin organización → null", async () => {
    resetInstanceOrgCache();
    selectQueue.push([]);
    await expect(resolveInstanceOrg()).resolves.toBe(null);
  });

  it("una sola organización → la suya", async () => {
    resetInstanceOrgCache();
    selectQueue.push([{ id: "org_unica" }]);
    await expect(resolveInstanceOrg()).resolves.toBe("org_unica");
  });

  it("dos organizaciones → null, no la primera de la tabla", async () => {
    resetInstanceOrgCache();
    selectQueue.push([{ id: "org_a" }, { id: "org_b" }]);
    await expect(resolveInstanceOrg()).resolves.toBe(null);
  });

  it("el cache caduca: un segundo negocio se nota sin reiniciar", async () => {
    resetInstanceOrgCache();
    selectQueue.push([{ id: "org_a" }]);
    await expect(resolveInstanceOrg()).resolves.toBe("org_a");
    // Segunda lectura: sale del cache, la cola está vacía → sin cache daría null.
    await expect(resolveInstanceOrg()).resolves.toBe("org_a");
    resetInstanceOrgCache();
    selectQueue.push([{ id: "org_a" }, { id: "org_b" }]);
    await expect(resolveInstanceOrg()).resolves.toBe(null);
  });
});

describe("referencia de cuenta compartida entre negocios", () => {
  it("sin filas → null", () => {
    expect(pickUnambiguousOrgRow([], "instagram", "acct_1")).toBeNull();
  });

  it("varias filas del mismo negocio → esa fila", () => {
    const rows = [{ organizationId: "org_a", v: 1 }, { organizationId: "org_a", v: 2 }];
    expect(pickUnambiguousOrgRow(rows, "instagram", "acct_1")).toBe(rows[0]);
  });

  it("filas de dos negocios → null y aviso, nunca el primero", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = [{ organizationId: "org_a" }, { organizationId: "org_b" }];
    expect(pickUnambiguousOrgRow(rows, "messenger", "acct_1")).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("varios negocios")
    );
    warn.mockRestore();
  });
});
