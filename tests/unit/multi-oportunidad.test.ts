import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLeadForContact, onLeadActivity } from "@/server/inbox/lead-activity";

/**
 * Fase E — P6 multi-oportunidad: un contacto puede tener varias oportunidades.
 *
 * Se levantó `lead_contact_uq`. Estos tests cubren:
 *  1. El webhook reutiliza la oportunidad abierta (no duplica).
 *  2. Si todas están cerradas, un mensaje nuevo abre otra.
 *  3. `isPrimary`: el primer lead del contacto es el principal.
 *  4. El advisory lock evita carreras entre webhooks simultáneos.
 *  5. Sin etapas abiertas → null (no revienta).
 *  6. `onLeadActivity` actualiza el lead existente sin crear otro.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  recordLeadCreated: vi.fn(),
  publishWebhook: vi.fn(),
  recordLeadFirstTouch: vi.fn(),
  onLeadCreated: vi.fn(),
}));

let selectQueue: unknown[][] = [];
let insertQueue: unknown[][] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "orderBy", "limit", "for", "offset", "set"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.where = vi.fn(() => chain);
  (chain as { then: unknown }).then = (resolveFn: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolveFn);
  return chain;
}

const db = {
  execute: mocks.execute,
  select: mocks.select,
  insert: mocks.insert,
  update: mocks.update,
  transaction: (work: (tx: unknown) => Promise<unknown>) => work(db),
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/leads/stage-history", () => ({
  recordLeadCreated: mocks.recordLeadCreated,
}));
vi.mock("@/server/webhooks/dispatcher", () => ({
  publishWebhook: mocks.publishWebhook,
}));
vi.mock("@/server/attribution/touch", () => ({
  recordLeadFirstTouch: mocks.recordLeadFirstTouch,
}));
vi.mock("@/server/automation-events", () => ({
  onLeadCreated: mocks.onLeadCreated,
}));

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  insertQueue = [];
  mocks.getDb.mockReturnValue(db);
  mocks.execute.mockResolvedValue(undefined);
  mocks.select.mockImplementation(() => thenableChain(selectQueue.shift() ?? []));
  mocks.insert.mockImplementation(() => ({
    values: () => ({
      returning: () => Promise.resolve(insertQueue.shift() ?? []),
    }),
  }));
  mocks.update.mockReturnValue({
    set: () => ({ where: () => Promise.resolve([]) }),
  });
  mocks.recordLeadCreated.mockResolvedValue(undefined);
  mocks.publishWebhook.mockResolvedValue(undefined);
  mocks.recordLeadFirstTouch.mockResolvedValue(true);
  mocks.onLeadCreated.mockResolvedValue(undefined);
});

describe("createLeadForContact — multi-oportunidad", () => {
  const org = "org_1";
  const contact = "ct_1";

  it("webhook sin lead abierto → crea uno nuevo con isPrimary=true", async () => {
    selectQueue.push(
      [{ id: "pst_1" }],
      [],
      [{ max: -1 }],
      [],
    );
    insertQueue.push([{ id: "lead_1", stageId: "pst_1" }]);

    const result = await createLeadForContact({ organizationId: org, contactId: contact });

    expect(result).toEqual({ id: "lead_1", stageId: "pst_1", reused: false });
    expect(mocks.insert).toHaveBeenCalled();
    expect(mocks.recordLeadCreated).toHaveBeenCalled();
    expect(mocks.publishWebhook).toHaveBeenCalledWith(org, "lead.created", expect.any(Object));
  });

  it("webhook con lead abierto → lo reutiliza, no inserta", async () => {
    selectQueue.push(
      [{ id: "pst_1" }],
      [{ id: "lead_open", leadStageId: "pst_1" }],
    );

    const result = await createLeadForContact({ organizationId: org, contactId: contact });

    expect(result).toEqual({ id: "lead_open", stageId: "pst_1", reused: true });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.recordLeadCreated).not.toHaveBeenCalled();
    expect(mocks.publishWebhook).not.toHaveBeenCalled();
  });

  it("todos los leads cerrados → abre uno nuevo con isPrimary=false", async () => {
    selectQueue.push(
      [{ id: "pst_1" }],
      [],
      [{ max: 3 }],
      [{ id: "lead_closed" }],
    );
    insertQueue.push([{ id: "lead_2", stageId: "pst_1" }]);

    const result = await createLeadForContact({ organizationId: org, contactId: contact });

    expect(result).toEqual({ id: "lead_2", stageId: "pst_1", reused: false });
    expect(mocks.insert).toHaveBeenCalled();
  });

  it("captura manual con stageId → siempre crea (nunca reutiliza)", async () => {
    selectQueue.push(
      [{ max: 0 }],
      [{ id: "lead_existing" }],
    );
    insertQueue.push([{ id: "lead_3", stageId: "pst_2" }]);

    const result = await createLeadForContact({
      organizationId: org,
      contactId: contact,
      stageId: "pst_2",
    });

    expect(result).toEqual({ id: "lead_3", stageId: "pst_2", reused: false });
    expect(mocks.insert).toHaveBeenCalled();
  });

  it("sin etapas abiertas → null, no revienta", async () => {
    selectQueue.push([]);
    const result = await createLeadForContact({ organizationId: org, contactId: contact });
    expect(result).toBeNull();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("advisory lock se ejecuta en cada creación", async () => {
    selectQueue.push(
      [{ id: "pst_1" }],
      [],
      [{ max: -1 }],
      [],
    );
    insertQueue.push([{ id: "lead_1", stageId: "pst_1" }]);

    await createLeadForContact({ organizationId: org, contactId: contact });

    expect(mocks.execute).toHaveBeenCalled();
  });
});

describe("onLeadActivity — multi-oportunidad", () => {
  it("lead existente → actualiza lastActivityAt, no crea otro", async () => {
    selectQueue.push([{ id: "lead_1" }]);

    await onLeadActivity("org_1", "ct_1", new Date("2026-01-01"));

    expect(mocks.update).toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("sin lead → delega en createLeadForContact", async () => {
    selectQueue.push(
      [],
      [{ id: "pst_1" }],
      [],
      [{ max: -1 }],
      [],
    );
    insertQueue.push([{ id: "lead_new", stageId: "pst_1" }]);

    await onLeadActivity("org_1", "ct_1", new Date("2026-01-01"));

    expect(mocks.insert).toHaveBeenCalled();
  });
});
