import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_FICHA_FIELDS, DEFAULT_AGENT_RULES } from "@/lib/agent-config";
import { schema } from "@/lib/db";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  chatJson: vi.fn(),
  resolveAiConfig: vi.fn(),
  isAiConfigured: vi.fn(),
  sendText: vi.fn(),
  publish: vi.fn(),
  createQuote: vi.fn(),
  getQuote: vi.fn(),
  sendQuote: vi.fn(),
}));

const selectQueue: unknown[][] = [];
const inserts: { table: unknown; values: unknown }[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
    chain[method] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const db = {
  select: () => thenableChain(selectQueue.shift() ?? []),
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      inserts.push({ table, values });
      return Promise.resolve(undefined);
    },
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/lib/ai", () => ({
  chatJson: mocks.chatJson,
  resolveAiConfig: mocks.resolveAiConfig,
  isAiConfigured: mocks.isAiConfigured,
}));
vi.mock("@/server/inbox/send", () => ({
  SendError: class SendError extends Error { code = "send_failed"; },
  sendText: mocks.sendText,
}));
vi.mock("@/server/events/bus", () => ({ publish: mocks.publish }));
vi.mock("@/server/agenda/flag", () => ({ agendaEnabled: () => false }));
vi.mock("@/server/quotes/service", () => ({
  createQuote: mocks.createQuote,
  getQuote: mocks.getQuote,
  sendQuote: mocks.sendQuote,
}));

function queueTurn(isTest = false) {
  const inboundAt = new Date();
  const product = {
    id: "cat_1",
    organizationId: "org_1",
    name: "Servicio premium",
    currency: "MXN",
    price: 25000,
    available: true,
    shortDescription: "Servicio completo",
    longDescription: null,
    imageUrl: null,
  };
  selectQueue.push(
    [{ id: "cv_1", organizationId: "org_1", contactId: "ct_1", channel: "whatsapp", isTest, aiEnabled: true, handoffAt: null, handoffReason: null, lastInboundAt: inboundAt }],
    [{ id: "agp_1", organizationId: "org_1", enabled: !isTest, name: "Sofi", rules: DEFAULT_AGENT_RULES, fichaFields: DEFAULT_AGENT_FICHA_FIELDS, maxResponseWaitSeconds: 0 }],
    [{ id: "msg_1", direction: "in", text: "Quiero una cotización de dos servicios", createdAt: inboundAt }],
    [],
    [product],
    [{ id: "stg_1", name: "Nuevo" }],
    [product]
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue.length = 0;
  inserts.length = 0;
  mocks.getDb.mockReturnValue(db);
  mocks.resolveAiConfig.mockResolvedValue({ token: "test-token", model: "test-model" });
  mocks.isAiConfigured.mockReturnValue(true);
  mocks.chatJson.mockResolvedValue({
    ok: true,
    data: { action: "create_quote", item_id: "cat_1", quantity: 2 },
  });
  mocks.sendText.mockResolvedValue(undefined);
  mocks.createQuote.mockResolvedValue("qt_1");
  mocks.getQuote.mockResolvedValue({ id: "qt_1", status: "draft", quoteNumber: "COT-0001", total: 58000 });
  mocks.sendQuote.mockResolvedValue({ total: 58000 });
});

describe("cotización formal del agente", () => {
  it("crea una cotización real con el catálogo y la envía al chat actual", async () => {
    queueTurn();
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.createQuote).toHaveBeenCalledWith("org_1", {
      contactId: "ct_1",
      items: [{
        productId: "cat_1",
        name: "Servicio premium",
        description: "Servicio completo",
        quantity: 2,
        unitPrice: 25000,
      }],
    }, undefined, { agentSourceMessageId: "msg_1" });
    expect(mocks.sendQuote).toHaveBeenCalledWith("org_1", "qt_1", "whatsapp", "cv_1");
    expect(mocks.sendText).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_1",
      conversationId: "cv_1",
      text: expect.stringContaining("COT-0001"),
      aiGenerated: true,
    }));
  });

  it("en el Laboratorio solo simula la respuesta y no crea ni envía cotizaciones", async () => {
    queueTurn(true);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.createQuote).not.toHaveBeenCalled();
    expect(mocks.sendQuote).not.toHaveBeenCalled();
    expect(mocks.sendText).not.toHaveBeenCalled();
    expect(inserts).toContainEqual(expect.objectContaining({
      table: schema.message,
      values: expect.objectContaining({
        direction: "out",
        aiGenerated: true,
        text: expect.stringContaining("conversación real"),
      }),
    }));
  });
});
