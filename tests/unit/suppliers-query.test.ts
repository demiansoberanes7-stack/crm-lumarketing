import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { GET } from "@/app/api/suppliers/route";

/**
 * La búsqueda de la pantalla de Proveedores.
 *
 * Dos defectos vivían en el `WHERE` armado a mano:
 *  - `%${q}%` sin escapar, donde un `%` escrito por el usuario se volvía
 *    comodín (buscar «100%» o un `%` suelto dejaba de ser una búsqueda);
 *  - `Number(rating)` tal cual: `?rating=abc` produce `NaN`, Postgres rechaza
 *    el entero y la lista completa respondía 500 — la clase de bug que ya se
 *    había cerrado en los otros listados.
 */
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  whereCalls: [] as unknown[],
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class extends Error {},
  requireSession: async () => ({ userId: "usr_1", organizationId: "org_1", role: "member" }),
  getSessionOrNull: async () => null,
}));

vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: vi.fn(async () => {}) }));

vi.mock("@/server/suppliers", () => ({ serializeSupplier: (row: unknown) => row }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.whereCalls = [];
  mocks.getDb.mockReturnValue({
    select: () => {
      const c: Record<string, unknown> = {};
      for (const m of ["from", "orderBy", "limit"]) c[m] = vi.fn(() => c);
      c.where = vi.fn((condition: unknown) => {
        mocks.whereCalls.push(condition);
        return c;
      });
      // La ruta hace `await db.select()...limit(200)` y después `.map`; sin esto
      // el espejo no es thenable y se rompe en el mock, no en el código.
      (c as { then: unknown }).then = (resolve: (value: unknown) => void) =>
        Promise.resolve([] as unknown[]).then(resolve);
      return c;
    },
  });
});

async function query(search: string) {
  const res = await GET(new Request(`http://local/api/suppliers${search}`));
  expect(res.status).toBe(200);
  const condition = mocks.whereCalls[0];
  const rendered = new PgDialect().sqlToQuery(condition as never);
  return { sql: rendered.sql, params: rendered.params as unknown[] };
}

describe("búsqueda por texto", () => {
  it("trata el % y el _ del término como caracteres literales", async () => {
    const { params } = await query("?q=100%25desc");
    const pattern = params.find((p) => typeof p === "string" && p.includes("100"));
    expect(pattern).toBe("%100\\%desc%");
  });

  it("un % suelto no se convierte en «devuélveme todo»", async () => {
    const { params } = await query("?q=%25");
    // El comodín del usuario va escapado dentro del patrón: `%\%%`.
    expect(params).toContain("%\\%%");
  });

  it("escapa el guion bajo igual que el porcentaje", async () => {
    const { params } = await query("?q=_promo");
    expect(params.some((p) => p === "%\\_promo%")).toBe(true);
  });

  it("sin término no añade la condición de texto", async () => {
    const { sql } = await query("");
    expect(sql).not.toMatch(/ilike/i);
  });
});

describe("filtro por calificación", () => {
  it("un rating válido sí filtra", async () => {
    const { sql, params } = await query("?rating=4");
    expect(sql).toContain("rating");
    expect(params).toContain(4);
  });

  it("basura, vacío o fuera de rango se ignora en lugar de provocar un 500", async () => {
    for (const search of ["?rating=abc", "?rating=", "?rating=9", "?rating=0", "?rating=-2"]) {
      const { sql } = await query(search);
      expect(sql).not.toContain("rating");
    }
  });
});
