import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { createQuote } from "@/server/quotes/service";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
  insert: vi.fn(),
  publishWebhook: vi.fn(),
}));

let selectQueue: unknown[][] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "orderBy", "limit"]) chain[method] = vi.fn(() => chain);
  chain.where = vi.fn((condition: unknown) => {
    mocks.where(condition);
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
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/webhooks/dispatcher", () => ({ publishWebhook: mocks.publishWebhook }));

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  mocks.getDb.mockReturnValue({ ...db, transaction: (work: (tx: typeof db) => Promise<unknown>) => work(db) });
  mocks.execute.mockResolvedValue(undefined);
  mocks.select.mockImplementation(() => thenableChain(selectQueue.shift() ?? []));
});

describe("idempotencia de cotizaciones del agente", () => {
  it("reutiliza la cotización asociada al mismo mensaje entrante", async () => {
    selectQueue.push(
      [{ quoteId: "qt_existing" }],
      [{ id: "qt_existing", quoteNumber: "COT-0007", total: 58000, contactId: "ct_1" }]
    );

    const id = await createQuote("org_1", {
      contactId: "ct_1",
      items: [{ productId: "cat_1", name: "Servicio", quantity: 2, unitPrice: 25000 }],
    }, undefined, { agentSourceMessageId: "msg_1" });

    expect(id).toBe("qt_existing");
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.publishWebhook).not.toHaveBeenCalled();
    const where = mocks.where.mock.calls[0]![0];
    const query = new PgDialect().sqlToQuery(where);
    expect(query.sql).toContain('"quote_event"."organization_id" = $1');
    expect(query.sql).toContain("->>'agentSourceMessageId'");
    expect(query.params).toContain("msg_1");
  });
});
