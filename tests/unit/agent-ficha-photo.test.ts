import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_FICHA_FIELDS, DEFAULT_AGENT_RULES } from "@/lib/agent-config";

/**
 * La foto del producto viaja con la ficha que manda el agente.
 *
 * Dos invariantes que aquí se prueban, en este orden:
 *
 *  1. El TEXTO es el paquete. La foto se lee antes de escribir en el chat y se
 *     manda después de su ficha; si falla la lectura, el adjunto o el canal, la
 *     ficha salió igual y el turno no se rompe ni se va a handoff.
 *  2. Ninguna omisión queda muda. Instagram, TikTok, Reseñas, Comentarios y
 *     Webchat no admiten adjuntos, y el Laboratorio nunca envía nada: sin el
 *     motivo en el log, «no me llegó la foto» es indistinguible de un bug.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  chatJson: vi.fn(),
  resolveAiConfig: vi.fn(),
  isAiConfigured: vi.fn(),
  sendText: vi.fn(),
  sendMediaMessage: vi.fn(),
  primaryImageFilesForChat: vi.fn(),
  publish: vi.fn(),
}));

const selectQueue: unknown[][] = [];
const journal: string[] = [];

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
  insert: () => ({ values: () => Promise.resolve(undefined) }),
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
  sendMediaMessage: mocks.sendMediaMessage,
  reactToInbound: vi.fn(),
}));
vi.mock("@/server/catalog/images", () => ({
  primaryImageFilesForChat: mocks.primaryImageFilesForChat,
  primaryImageSnapshots: async () => ({}),
}));
vi.mock("@/server/events/bus", () => ({ publish: mocks.publish }));
vi.mock("@/server/agenda/flag", () => ({ agendaEnabled: () => false }));
vi.mock("@/server/quotes/service", () => ({
  createQuote: vi.fn(),
  getQuote: vi.fn(),
  sendQuote: vi.fn(),
}));

const product = (over: Record<string, unknown> = {}) => ({
  id: "cat_1",
  organizationId: "org_1",
  name: "Ramo primavera",
  currency: "MXN",
  price: 35000,
  stock: 5,
  available: true,
  shortDescription: "Rosas y tulipanes",
  longDescription: null,
  ...over,
});

function queueTurn(
  products: Record<string, unknown>[],
  options: { channel?: string; isTest?: boolean } = {}
) {
  const inboundAt = new Date();
  selectQueue.push(
    [
      {
        id: "cv_1",
        organizationId: "org_1",
        contactId: "ct_1",
        channel: options.channel ?? "whatsapp",
        isTest: options.isTest ?? false,
        aiEnabled: true,
        handoffAt: null,
        handoffReason: null,
        lastInboundAt: inboundAt,
      },
    ],
    [
      {
        id: "agp_1",
        organizationId: "org_1",
        enabled: true,
        name: "Sofi",
        rules: DEFAULT_AGENT_RULES,
        fichaFields: DEFAULT_AGENT_FICHA_FIELDS,
        maxResponseWaitSeconds: 0,
        activeInNewConversations: true,
        reactWithEmoji: false,
      },
    ],
    [{ id: "msg_1", direction: "in", text: "¿Tienen ramos?", createdAt: inboundAt }],
    [],
    [products[0] ?? product()],
    [{ id: "stg_1", name: "Nuevo" }],
    [],
    products
  );
}

const photo = (fileName: string) => ({
  data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  mimeType: "image/png",
  fileName,
});

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue.length = 0;
  journal.length = 0;
  mocks.getDb.mockReturnValue(db);
  mocks.resolveAiConfig.mockResolvedValue({ token: "test-token", model: "test-model" });
  mocks.isAiConfigured.mockReturnValue(true);
  mocks.sendText.mockImplementation(async (input: { text: string }) => {
    journal.push(`text:${input.text.split("\n")[0]}`);
  });
  mocks.sendMediaMessage.mockImplementation(async () => {
    journal.push("photo");
  });
  mocks.primaryImageFilesForChat.mockResolvedValue({ files: {}, unreadable: [] });
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

async function runFichas(action: Record<string, unknown>) {
  mocks.chatJson.mockResolvedValueOnce({ ok: true, data: action });
  const { runAgentTurn } = await import("@/server/ai/pipeline");
  await runAgentTurn("cv_1");
  return journal;
}

describe("foto en la ficha del agente", () => {
  it("manda cada foto después del texto de su ficha", async () => {
    const servicio = product({ id: "cat_2", name: "Servicio premium" });
    queueTurn([product(), servicio]);
    mocks.primaryImageFilesForChat.mockResolvedValue({
      files: { cat_1: photo("ramo.png"), cat_2: photo("servicio.png") },
      unreadable: [],
    });

    const sent = await runFichas({ action: "send_quote", item_ids: ["cat_1", "cat_2"] });

    // El orden es lo que el cliente ve: ficha, su foto, ficha, su foto.
    expect(sent).toEqual([
      "text:*Ramo primavera*",
      "photo",
      "text:*Servicio premium*",
      "photo",
    ]);
    expect(mocks.sendMediaMessage.mock.calls.map((call) => call[0].file.fileName)).toEqual([
      "ramo.png",
      "servicio.png",
    ]);
  });

  it("las fotos de todas las fichas se leen en una sola consulta", async () => {
    queueTurn([product(), product({ id: "cat_2", name: "Servicio premium" })]);
    await runFichas({ action: "send_quote", item_ids: ["cat_1", "cat_2"] });

    expect(mocks.primaryImageFilesForChat).toHaveBeenCalledTimes(1);
    expect(mocks.primaryImageFilesForChat).toHaveBeenCalledWith("org_1", ["cat_1", "cat_2"]);
  });

  it("el envío es de la IA: sin etiqueta de agente humano", async () => {
    queueTurn([product()]);
    mocks.primaryImageFilesForChat.mockResolvedValue({
      files: { cat_1: photo("ramo.png") },
      unreadable: [],
    });
    await runFichas({ action: "send_quote", item_id: "cat_1" });

    expect(mocks.sendMediaMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "cv_1", organizationId: "org_1" })
    );
    // La manda la IA, no una persona: HUMAN_AGENT es solo para envíos manuales,
    // y heredar la etiqueta del texto pintaría de humano al agente.
    expect(mocks.sendMediaMessage.mock.calls[0]![0].humanAgentTagAllowed).not.toBe(true);
  });

  it("con una sola ficha pegada al saludo, la foto va al final", async () => {
    queueTurn([product()]);
    mocks.primaryImageFilesForChat.mockResolvedValue({
      files: { cat_1: photo("ramo.png") },
      unreadable: [],
    });

    const sent = await runFichas({
      action: "send_quote",
      item_id: "cat_1",
      reply: "Con gusto:",
    });

    expect(sent).toEqual(["text:Con gusto:", "photo"]);
  });

  it("si el adjunto falla, la ficha ya entregada no rompe el turno", async () => {
    queueTurn([product()]);
    mocks.primaryImageFilesForChat.mockResolvedValue({
      files: { cat_1: photo("ramo.png") },
      unreadable: [],
    });
    mocks.sendMediaMessage.mockRejectedValue(new Error("Meta 503"));

    const sent = await runFichas({ action: "send_quote", item_id: "cat_1" });

    expect(sent).toEqual(["text:*Ramo primavera*"]);
    expect(mocks.sendText).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("si leer la foto cuesta, la ficha igual se manda", async () => {
    queueTurn([product()]);
    mocks.primaryImageFilesForChat.mockRejectedValue(new Error("db caida"));

    const sent = await runFichas({ action: "send_quote", item_id: "cat_1" });

    expect(sent).toEqual(["text:*Ramo primavera*"]);
  });

  it("un canal sin adjuntos manda solo el texto y deja el motivo en el log", async () => {
    queueTurn([product()], { channel: "instagram" });
    mocks.primaryImageFilesForChat.mockResolvedValue({
      files: { cat_1: photo("ramo.png") },
      unreadable: [],
    });

    const sent = await runFichas({ action: "send_quote", item_id: "cat_1" });

    // En Instagram el formato quita los asteriscos: es el mismo texto, sin markdown.
    expect(sent).toEqual(["text:Ramo primavera"]);
    expect(mocks.sendMediaMessage).not.toHaveBeenCalled();
    // Ni siquiera se lee el disco cuando el canal no lo puede recibir.
    expect(mocks.primaryImageFilesForChat).not.toHaveBeenCalled();
    expect(infoSpy.mock.calls.map((call) => String(call[0])).join(" ")).toContain(
      "no admite adjuntos salientes"
    );
  });

  it("un canal que la app no conoce no se disfraza de WhatsApp", async () => {
    // `conversation.channel` es un varchar sin restricción: un valor fuera de la
    // unión (una fila vieja, un import, un canal futuro) cae en WhatsApp en
    // `capabilitiesFor`. Para la ventana eso es conservador; para un adjunto
    // inventaría una capacidad y dejaría un mensaje `failed` en el hilo.
    queueTurn([product()], { channel: "email" });
    mocks.primaryImageFilesForChat.mockResolvedValue({
      files: { cat_1: photo("ramo.png") },
      unreadable: [],
    });

    const sent = await runFichas({ action: "send_quote", item_id: "cat_1" });

    // La ficha sale igual (con el formato que la app elige para un canal que no
    // reconoce); lo que no sale es la foto.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Ramo primavera");
    expect(mocks.sendMediaMessage).not.toHaveBeenCalled();
    expect(mocks.primaryImageFilesForChat).not.toHaveBeenCalled();
    expect(infoSpy.mock.calls.map((call) => String(call[0])).join(" ")).toContain(
      "email no admite adjuntos salientes"
    );
  });

  it("el Laboratorio no manda fotos: solo persiste texto", async () => {
    queueTurn([product()], { isTest: true });
    mocks.primaryImageFilesForChat.mockResolvedValue({
      files: { cat_1: photo("ramo.png") },
      unreadable: [],
    });

    await runFichas({ action: "send_quote", item_id: "cat_1" });

    expect(mocks.sendMediaMessage).not.toHaveBeenCalled();
    expect(mocks.primaryImageFilesForChat).not.toHaveBeenCalled();
  });

  it("un archivo perdido se avisa, y la ficha sale con su texto", async () => {
    queueTurn([product()]);
    mocks.primaryImageFilesForChat.mockResolvedValue({
      files: {},
      unreadable: ["cat_1"],
    });

    const sent = await runFichas({ action: "send_quote", item_id: "cat_1" });

    expect(sent).toEqual(["text:*Ramo primavera*"]);
    expect(warnSpy.mock.calls.map((call) => String(call[0])).join(" ")).toContain(
      "su archivo ya no está en disco"
    );
  });

  it("un catálogo sin fotos no genera ruido: la ficha es la de siempre", async () => {
    queueTurn([product()]);

    const sent = await runFichas({ action: "send_quote", item_id: "cat_1" });

    expect(sent).toEqual(["text:*Ramo primavera*"]);
    const aboutPhotos = [infoSpy, warnSpy, errorSpy]
      .flatMap((spy) => spy.mock.calls.map((call) => String(call[0])))
      .filter((line) => line.includes("foto"));
    expect(aboutPhotos).toEqual([]);
  });
});
