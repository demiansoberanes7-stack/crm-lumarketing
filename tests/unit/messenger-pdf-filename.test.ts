import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nombre del PDF de cotización enviado por Messenger.
 *
 * El mismo defecto que WhatsApp: por JSON (`attachmentUrl` + `attachmentName`)
 * el proveedor ignora el nombre y el cliente ve su clave alfanumérica. El
 * documento debe salir por multipart, donde Zernio usa el nombre subido.
 */

const mocks = vi.hoisted(() => ({
  zernioFetch: vi.fn(),
  zernioUploadMediaDirect: vi.fn(),
  graphRequest: vi.fn(),
}));

vi.mock("@/server/zernio", () => ({
  sendZernioMessage: vi.fn(),
  zernioFetch: mocks.zernioFetch,
  zernioUploadMediaDirect: mocks.zernioUploadMediaDirect,
}));

vi.mock("@/lib/meta/client", () => ({
  graphRequest: mocks.graphRequest,
  MetaApiError: class extends Error {
    status: number;
    constructor(message: string, opts?: { status?: number }) {
      super(message);
      this.status = opts?.status ?? 500;
    }
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.zernioUploadMediaDirect.mockResolvedValue({
    url: "https://cdn.zernio.com/1792119932129_dtjo1cnt_bafdf799.pdf",
    filename: "1792119932129_dtjo1cnt_bafdf799.pdf",
    contentType: "application/pdf",
    size: 12345,
  });
  mocks.zernioFetch.mockResolvedValue({ data: { messageId: "msg_123" } });
});

async function sendMedia(input: { fileName?: string; data?: Buffer; humanAgentTag?: boolean }) {
  const { sendMessengerMedia } = await import("@/server/messenger/send");
  return sendMessengerMedia({
    credentials: { source: "zernio", token: "token_abc", accountRef: "acc_123" } as never,
    recipient: "psid_1",
    threadRef: "thread_1",
    data: input.data ?? Buffer.from("pdf"),
    mimeType: "application/pdf",
    fileName: input.fileName,
    attachmentType: "file",
    humanAgentTag: input.humanAgentTag ?? false,
    idempotencyKey: "idem_1",
  });
}

describe("sendMessengerMedia - nombre del documento", () => {
  it("envía el PDF por multipart con el nombre del cliente y no sube a la CDN", async () => {
    await sendMedia({ fileName: "Cotizacion Landing Page - Juan Perez.pdf" });
    const call = mocks.zernioFetch.mock.calls[0]!;
    expect(call[1]!.body).toBeUndefined();
    const form = call[1]!.formData as FormData;
    expect(form.get("accountId")).toBe("acc_123");
    const attachment = form.get("attachment") as File;
    expect(attachment.name).toBe("Cotizacion Landing Page - Juan Perez.pdf");
    expect(attachment.type).toBe("application/pdf");
    expect(mocks.zernioUploadMediaDirect).not.toHaveBeenCalled();
  });

  it("lleva la etiqueta HUMAN_AGENT en el multipart fuera de ventana", async () => {
    await sendMedia({ fileName: "Cotizacion X - Y.pdf", humanAgentTag: true });
    const form = mocks.zernioFetch.mock.calls[0]![1]!.formData as FormData;
    expect(form.get("messagingType")).toBe("MESSAGE_TAG");
    expect(form.get("messageTag")).toBe("HUMAN_AGENT");
  });

  it("usa un nombre de respaldo si no viene fileName", async () => {
    await sendMedia({});
    const form = mocks.zernioFetch.mock.calls[0]![1]!.formData as FormData;
    expect((form.get("attachment") as File).name).toBe("documento.pdf");
  });

  it("deja la vía JSON solo para documentos sobre el límite multipart", async () => {
    await sendMedia({
      fileName: "grande.pdf",
      data: Buffer.alloc(25 * 1024 * 1024 + 1, 1),
    });
    const call = mocks.zernioFetch.mock.calls[0]!;
    expect(call[1]!.formData).toBeUndefined();
    const body = call[1]!.body as Record<string, unknown>;
    expect(body.attachmentName).toBe("grande.pdf");
    expect(mocks.zernioUploadMediaDirect).toHaveBeenCalledOnce();
  });

  it("no toca multipart en otros tipos de adjunto", async () => {
    const { sendMessengerMedia } = await import("@/server/messenger/send");
    await sendMessengerMedia({
      credentials: { source: "zernio", token: "token_abc", accountRef: "acc_123" } as never,
      recipient: "psid_1",
      threadRef: "thread_1",
      data: Buffer.from("png"),
      mimeType: "image/png",
      fileName: "foto.png",
      attachmentType: "image",
      humanAgentTag: false,
    });
    expect(mocks.zernioFetch.mock.calls[0]![1]!.formData).toBeUndefined();
  });
});
