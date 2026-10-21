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
  reactToInbound: vi.fn(),
}));
vi.mock("@/server/events/bus", () => ({ publish: mocks.publish }));
vi.mock("@/server/agenda/flag", () => ({ agendaEnabled: () => false }));
vi.mock("@/server/quotes/service", () => ({
  createQuote: mocks.createQuote,
  getQuote: mocks.getQuote,
  sendQuote: mocks.sendQuote,
}));

const baseProduct = {
  id: "cat_1",
  organizationId: "org_1",
  name: "Servicio premium",
  currency: "MXN",
  price: 25000,
  stock: null,
  available: true,
  shortDescription: "Servicio completo",
  longDescription: null,
};

function queueTurn(
  isTest = false,
  options: {
    extras?: unknown[][];
    quoteProducts?: unknown[];
    rules?: Record<string, boolean>;
  } = {}
) {
  const inboundAt = new Date();
  selectQueue.push(
    [{ id: "cv_1", organizationId: "org_1", contactId: "ct_1", channel: "whatsapp", isTest, aiEnabled: true, handoffAt: null, handoffReason: null, lastInboundAt: inboundAt }],
    [{ id: "agp_1", organizationId: "org_1", enabled: !isTest, name: "Sofi", rules: options.rules ?? DEFAULT_AGENT_RULES, fichaFields: DEFAULT_AGENT_FICHA_FIELDS, maxResponseWaitSeconds: 0, activeInNewConversations: true, reactWithEmoji: false }],
    [{ id: "msg_1", direction: "in", text: "Quiero una cotización de dos servicios", createdAt: inboundAt }],
    [],
    [baseProduct],
    [{ id: "stg_1", name: "Nuevo" }],
    [], // datos de empresa (el nombre va ahora en el system prompt)
    ...(options.extras ?? []),
    options.quoteProducts ?? [baseProduct]
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
    expect(mocks.sendQuote).toHaveBeenCalledWith("org_1", "qt_1", {
      channel: "whatsapp",
      conversationId: "cv_1",
    });
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

describe("búsqueda de inventario del agente", () => {
  const ramo = {
    ...baseProduct,
    id: "cat_2",
    name: "Ramo primavera",
    price: 35000,
    stock: 5,
    shortDescription: "Rosas y tulipanes",
  };

  it("consulta el inventario y cotiza con el ID exacto devuelto por el sistema", async () => {
    queueTurn(false, { extras: [[ramo]], quoteProducts: [ramo] });
    mocks.chatJson
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "search_inventory", query: "ramo primavera" },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { action: "create_quote", item_id: "cat_2", quantity: 2 },
      });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.chatJson).toHaveBeenCalledTimes(2);
    const secondMessages = mocks.chatJson.mock.calls[1]![1] as { role: string; content: string }[];
    const toolResult = secondMessages.find((m) => m.content.startsWith("RESULTADOS DE INVENTARIO"));
    expect(toolResult?.content).toContain("ID: cat_2");
    expect(toolResult?.content).toContain("Inventario: 5 piezas");
    expect(mocks.createQuote).toHaveBeenCalledWith("org_1", {
      contactId: "ct_1",
      items: [{
        productId: "cat_2",
        name: "Ramo primavera",
        description: "Rosas y tulipanes",
        quantity: 2,
        unitPrice: 35000,
      }],
    }, undefined, { agentSourceMessageId: "msg_1" });
    expect(mocks.sendQuote).toHaveBeenCalled();
  });

  it("cotiza varios productos y suma líneas repetidas antes de crear la cotización", async () => {
    const servicio = { ...baseProduct, id: "cat_2", name: "Instalación", price: 10000, stock: null };
    queueTurn(false, { quoteProducts: [baseProduct, servicio] });
    mocks.chatJson.mockResolvedValueOnce({
      ok: true,
      data: {
        action: "create_quote",
        items: [
          { item_id: "cat_1", quantity: 1 },
          { item_id: "cat_2", quantity: 2 },
          { item_id: "cat_1", quantity: 1 },
        ],
      },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.createQuote).toHaveBeenCalledWith("org_1", {
      contactId: "ct_1",
      items: [
        {
          productId: "cat_1",
          name: "Servicio premium",
          description: "Servicio completo",
          quantity: 2,
          unitPrice: 25000,
        },
        {
          productId: "cat_2",
          name: "Instalación",
          description: "Servicio completo",
          quantity: 2,
          unitPrice: 10000,
        },
      ],
    }, undefined, { agentSourceMessageId: "msg_1" });
  });

  it("no cotiza un producto despublicado y ofrece alternativas", async () => {
    queueTurn(false, { quoteProducts: [{ ...baseProduct, available: false }] });
    mocks.chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "create_quote", item_id: "cat_1", quantity: 1 },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.createQuote).not.toHaveBeenCalled();
    expect(mocks.sendText).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("ya no está disponible"),
    }));
  });

  it("avisa las existencias reales en vez de crear una cotización sin stock", async () => {
    queueTurn(false, { quoteProducts: [{ ...baseProduct, stock: 2 }] });
    mocks.chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "create_quote", item_id: "cat_1", quantity: 3 },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.createQuote).not.toHaveBeenCalled();
    expect(mocks.sendText).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("solo quedan 2 piezas"),
    }));
  });

  it("con la regla de catálogo apagada responde sin buscar en el inventario", async () => {
    queueTurn(false, {
      rules: { ...DEFAULT_AGENT_RULES, sendProductQuotes: false },
    });
    mocks.chatJson.mockResolvedValueOnce({
      ok: true,
      data: { action: "search_inventory", query: "ramo", reply: "Déjame revisar." },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.chatJson).toHaveBeenCalledTimes(1);
    expect(mocks.sendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Déjame revisar." }));
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });

  it("limita a dos búsquedas por turno y responde con lo que tenga", async () => {
    queueTurn(false, { extras: [[ramo], [ramo]] });
    mocks.chatJson.mockResolvedValue({
      ok: true,
      data: { action: "search_inventory", query: "ramo", reply: "Sigo buscando." },
    });

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");

    expect(mocks.chatJson).toHaveBeenCalledTimes(3);
    expect(mocks.sendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Sigo buscando." }));
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });
});
