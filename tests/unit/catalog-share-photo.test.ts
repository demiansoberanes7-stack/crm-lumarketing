import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendProductToConversation } from "@/server/catalog/send";

/**
 * Compartir un producto desde Inventario también lleva su foto.
 *
 * Es el mismo contrato que la ficha del agente, pero manual: la etiqueta
 * HUMAN_AGENT sí aplica (la pidió el operador), y el adjunto nunca puede hacer
 * fracasar el envío — la ficha ya está en el chat cuando la foto se intenta.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  select: vi.fn(),
  sendText: vi.fn(),
  sendMediaMessage: vi.fn(),
  primaryImageFilesForChat: vi.fn(),
}));

let selectQueue: unknown[][] = [];
const journal: string[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit"]) chain[method] = vi.fn(() => chain);
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/inbox/send", () => ({
  SendError: class SendError extends Error { code = "send_failed"; },
  sendText: mocks.sendText,
  sendMediaMessage: mocks.sendMediaMessage,
}));
vi.mock("@/server/catalog/images", () => ({
  primaryImageFilesForChat: mocks.primaryImageFilesForChat,
}));

const PRODUCT = {
  id: "cat_1",
  organizationId: "org_1",
  name: "Ramo primavera",
  currency: "MXN",
  price: 35000,
  stock: 5,
  available: true,
  shortDescription: "Rosas y tulipanes",
  longDescription: null,
  websiteUrl: null,
};

const photo = { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png", fileName: "ramo.png" };

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  journal.length = 0;
  mocks.getDb.mockReturnValue({ select: () => thenableChain(selectQueue.shift() ?? []) });
  mocks.select.mockImplementation(() => thenableChain([]));
  mocks.sendText.mockImplementation(async () => {
    journal.push("text");
    return { messageId: "ms_1" };
  });
  mocks.sendMediaMessage.mockImplementation(async () => {
    journal.push("photo");
    return { messageId: "ms_2" };
  });
  mocks.primaryImageFilesForChat.mockResolvedValue({ files: {}, unreadable: [] });
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

async function share(channel: string) {
  selectQueue.push([PRODUCT], [{ id: "cv_1", organizationId: "org_1", channel, isTest: false }]);
  return sendProductToConversation("org_1", "cat_1", "cv_1");
}

describe("foto al compartir un producto", () => {
  it("en WhatsApp manda la ficha y su foto, etiquetada como agente humano", async () => {
    mocks.primaryImageFilesForChat.mockResolvedValue({ files: { cat_1: photo }, unreadable: [] });

    const result = await share("whatsapp");

    expect(journal).toEqual(["text", "photo"]);
    expect(result.messageId).toBe("ms_1");
    expect(mocks.sendMediaMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "cv_1", organizationId: "org_1", humanAgentTagAllowed: true })
    );
  });

  it("en Instagram sale solo el texto, con el motivo en el log", async () => {
    mocks.primaryImageFilesForChat.mockResolvedValue({ files: { cat_1: photo }, unreadable: [] });

    await share("instagram");

    expect(journal).toEqual(["text"]);
    expect(mocks.primaryImageFilesForChat).not.toHaveBeenCalled();
    expect(infoSpy.mock.calls.map((call) => String(call[0])).join(" ")).toContain(
      "no admite adjuntos"
    );
  });

  it("un canal que la app no conoce tampoco se disfraza de WhatsApp", async () => {
    mocks.primaryImageFilesForChat.mockResolvedValue({ files: { cat_1: photo }, unreadable: [] });

    await share("email");

    expect(journal).toEqual(["text"]);
    expect(mocks.primaryImageFilesForChat).not.toHaveBeenCalled();
    expect(infoSpy.mock.calls.map((call) => String(call[0])).join(" ")).toContain(
      "email no admite adjuntos"
    );
  });

  it("un producto sin fotos no deja ningún aviso: es el estado normal", async () => {
    await share("whatsapp");

    expect(journal).toEqual(["text"]);
    const mentions = [infoSpy, warnSpy, errorSpy]
      .flatMap((spy) => spy.mock.calls.map((call) => String(call[0])))
      .filter((line) => line.includes("foto"));
    expect(mentions).toEqual([]);
  });

  it("un archivo perdido se avisa y la ficha sigue considerada enviada", async () => {
    mocks.primaryImageFilesForChat.mockResolvedValue({ files: {}, unreadable: ["cat_1"] });

    const result = await share("whatsapp");

    expect(journal).toEqual(["text"]);
    expect(result.messageId).toBe("ms_1");
    expect(warnSpy.mock.calls.map((call) => String(call[0])).join(" ")).toContain(
      "ya no está en disco"
    );
  });

  it("si la plataforma rechaza el adjunto, el envío de la ficha no se revierte", async () => {
    mocks.primaryImageFilesForChat.mockResolvedValue({ files: { cat_1: photo }, unreadable: [] });
    mocks.sendMediaMessage.mockRejectedValue(new Error("Meta 503"));

    const result = await share("whatsapp");

    expect(result.messageId).toBe("ms_1");
    expect(errorSpy).toHaveBeenCalled();
  });
});
