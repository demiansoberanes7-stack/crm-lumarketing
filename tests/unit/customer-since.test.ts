import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  reportStageChange: vi.fn(),
  publishWebhook: vi.fn(),
  onStageChanged: vi.fn(),
}));

const state = {
  rowsByTable: {} as Record<string, unknown[][]>,
  updates: [] as { table: string; values: Record<string, unknown> }[],
  stageEvents: [] as Record<string, unknown>[],
};

function transactionDb() {
  const tx = {
    select: () => {
      const chain: Record<string, unknown> = {};
      let table = "";
      const rows = () => state.rowsByTable[table]?.shift() ?? [];
      chain.from = (source: unknown) => {
        table = getTableName(source as never);
        return chain;
      };
      chain.leftJoin = () => chain;
      chain.where = () => chain;
      chain.limit = () => Promise.resolve(rows());
      return chain;
    },
    update: (tableObject: unknown) => {
      const table = getTableName(tableObject as never);
      return {
        set: (values: Record<string, unknown>) => ({
          where: () => {
            state.updates.push({ table, values });
            return Promise.resolve([]);
          },
        }),
      };
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        state.stageEvents.push(values);
        return Promise.resolve([]);
      },
    }),
  };
  return { transaction: (run: (value: typeof tx) => Promise<unknown>) => run(tx) };
}

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));
vi.mock("@/server/attribution/conversions", () => ({ reportStageChange: mocks.reportStageChange }));
vi.mock("@/server/webhooks/dispatcher", () => ({ publishWebhook: mocks.publishWebhook }));
vi.mock("@/server/automation-events", () => ({ onStageChanged: mocks.onStageChanged }));

import { moveLeadToStage } from "@/server/leads/stage-history";

beforeEach(() => {
  vi.resetAllMocks();
  state.updates = [];
  state.stageEvents = [];
  const lead = {
    id: "lead_1",
    organizationId: "org_1",
    contactId: "contact_1",
    stageId: "stage_open",
    archivedAt: null,
    isPrimary: true,
    lastActivityAt: null,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
  };
  state.rowsByTable = {
    lead: [
      [{ lead, stage: { id: "stage_open", name: "Nuevo", kind: "open" } }],
      [{ ...lead, stageId: "stage_won" }],
    ],
    pipeline_stage: [[{ id: "stage_won", name: "Cliente", kind: "won" }]],
  };
  mocks.getDb.mockReturnValue(transactionDb());
  mocks.reportStageChange.mockResolvedValue(undefined);
  mocks.publishWebhook.mockResolvedValue(undefined);
  mocks.onStageChanged.mockResolvedValue(undefined);
});

describe("cliente persistente al ganar una oportunidad", () => {
  it("marca customerSince en la misma transacción al entrar a una etapa ganada", async () => {
    const occurredAt = new Date("2026-11-07T12:00:00.000Z");

    const result = await moveLeadToStage({
      organizationId: "org_1",
      leadId: "lead_1",
      toStageId: "stage_won",
      source: "dueno",
      occurredAt,
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(state.updates).toContainEqual({
      table: "contact",
      values: { customerSince: occurredAt, updatedAt: expect.any(Date) },
    });
    expect(state.stageEvents[0]).toMatchObject({ toStageKind: "won", contactId: "contact_1" });
  });
});
