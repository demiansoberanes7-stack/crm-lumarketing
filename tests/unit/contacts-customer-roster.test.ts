import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  recordDiagnostic: vi.fn().mockImplementation(async (input: { error?: unknown }) => {
    if (input.error instanceof Error) console.error(input.error);
  }),
  getDb: vi.fn(),
}));

const state = {
  rowsByTable: {} as Record<string, unknown[][]>,
  filters: [] as { table: string; sql: string; params: unknown[] }[],
};

function fakeDb() {
  return {
    select: () => {
      const chain: Record<string, unknown> = {};
      let table = "";
      const rows = () => state.rowsByTable[table]?.shift() ?? [];
      chain.from = (source: unknown) => {
        table = getTableName(source as never);
        return chain;
      };
      chain.innerJoin = () => chain;
      chain.where = (condition: unknown) => {
        const query = new PgDialect().sqlToQuery(condition as never);
        state.filters.push({ table, sql: query.sql, params: query.params });
        return chain;
      };
      chain.orderBy = () => chain;
      chain.limit = () => Promise.resolve(rows());
      (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
        Promise.resolve(rows()).then(resolve);
      return chain;
    },
  };
}

vi.mock("@/lib/auth/session", () => ({
  requireSession: mocks.requireSession,
  UnauthorizedError: class extends Error {},
}));
vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: mocks.recordDiagnostic }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));

import { GET } from "@/app/api/contacts/route";

beforeEach(() => {
  vi.resetAllMocks();
  state.filters = [];
  state.rowsByTable = {
    lead: [[]],
    contact: [[{
      id: "contact_1",
      organizationId: "org_1",
      name: "Ana Cliente",
      phone: "5215512345678",
      notes: null,
      channel: "whatsapp",
      archivedAt: null,
      customerSince: new Date("2026-11-01T00:00:00.000Z"),
      source: "referido",
      purchaseProduct: null,
      purchaseDate: null,
      purchaseAmountCents: null,
      medium: null,
      mediumDetail: null,
      ficha: null,
      waMarketingOptInAt: null,
      waMarketingOptInSource: null,
    }]],
  };
  mocks.getDb.mockReturnValue(fakeDb());
  mocks.requireSession.mockResolvedValue({ userId: "user_1", organizationId: "org_1", role: "owner" });
  mocks.recordDiagnostic.mockImplementation(async (input: { error?: unknown }) => {
    if (input.error instanceof Error) console.error(input.error);
  });
});

describe("Clientes: cartera persistente", () => {
  it("incluye al cliente aunque ya no tenga un lead activo en el Pipeline", async () => {
    const response = await GET(new Request("http://local/api/contacts?won=1"));

    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    const body = (await response.json()) as { contacts: { id: string; stageName: string | null }[] };
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0]?.id).toBe("contact_1");
    expect(body.contacts[0]?.stageName).toBeNull();
    const contactFilter = state.filters.find((filter) => filter.table === "contact");
    expect(contactFilter?.sql).toContain('"contact"."customer_since" is not null');
    expect(state.rowsByTable.lead).toEqual([]);
  });
});
