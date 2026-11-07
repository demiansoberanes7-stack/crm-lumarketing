import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
const state = {
  leadRows: [] as unknown[][],
  updates: [] as { values: Record<string, unknown>; sql: string; params: unknown[] }[],
};

function fakeDb() {
  return {
    select: () => {
      const chain: Record<string, unknown> = {};
      let table = "";
      chain.from = (source: unknown) => {
        table = getTableName(source as never);
        return chain;
      };
      chain.where = () => chain;
      chain.limit = () => Promise.resolve(table === "lead" ? state.leadRows.shift() ?? [] : []);
      return chain;
    },
    update: (tableObject: unknown) => {
      const table = getTableName(tableObject as never);
      return {
        set: (values: Record<string, unknown>) => ({
          where: (condition: unknown) => {
            const query = new PgDialect().sqlToQuery(condition as never);
            if (table === "lead") state.updates.push({ values, sql: query.sql, params: query.params });
            return Promise.resolve([]);
          },
        }),
      };
    },
  };
}

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));

import { archiveLeadFromPipeline } from "@/server/leads/service";

beforeEach(() => {
  vi.clearAllMocks();
  state.leadRows = [];
  state.updates = [];
  mocks.getDb.mockReturnValue(fakeDb());
});

describe("archiveLeadFromPipeline", () => {
  it("archiva solo la oportunidad del tenant, no borra el contacto ni el lead", async () => {
    state.leadRows = [[{ id: "lead_1", archivedAt: null }]];

    await expect(archiveLeadFromPipeline({ organizationId: "org_1", leadId: "lead_1" }))
      .resolves.toEqual({ ok: true });

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.values).toEqual({
      archivedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(state.updates[0]?.sql).toContain('"lead"."organization_id"');
    expect(state.updates[0]?.params).toContain("org_1");
    expect(state.updates[0]?.params).toContain("lead_1");
    expect(state.updates[0]?.sql).toContain('"lead"."archived_at" is null');
  });

  it("repetir el retiro es idempotente y no borra el cliente", async () => {
    state.leadRows = [[{ id: "lead_1", archivedAt: new Date() }]];

    await expect(archiveLeadFromPipeline({ organizationId: "org_1", leadId: "lead_1" }))
      .resolves.toEqual({ ok: true });
    expect(state.updates).toHaveLength(0);
  });

  it("no encuentra ni toca una oportunidad ajena o inexistente", async () => {
    state.leadRows = [[]];

    await expect(archiveLeadFromPipeline({ organizationId: "org_1", leadId: "lead_other" }))
      .resolves.toEqual({ ok: false });
    expect(state.updates).toHaveLength(0);
  });
});
