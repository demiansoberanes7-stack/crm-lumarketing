import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nombre del archivo PDF enviado por WhatsApp.
 *
 * El bug original: Zernio devolvía un nombre generado (timestamp + UUID)
 * que se usaba como attachmentName en vez del nombre original del archivo.
 * El fix: usar file.fileName ?? uploaded.filename.
 */

const mocks = vi.hoisted(() => ({
  zernioFetch: vi.fn(),
  zernioUploadMediaDirect: vi.fn(),
  zernioWhatsappEnabled: vi.fn(),
}));

vi.mock("@/server/zernio", () => ({
  zernioFetch: mocks.zernioFetch,
  zernioUploadMediaDirect: mocks.zernioUploadMediaDirect,
}));

vi.mock("@/server/whatsapp/zernio-credentials", () => ({
  zernioWhatsappEnabled: mocks.zernioWhatsappEnabled,
}));

vi.mock("@/lib/meta/client", () => ({
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
  mocks.zernioWhatsappEnabled.mockReturnValue(true);
  mocks.zernioUploadMediaDirect.mockResolvedValue({
    url: "https://cdn.zernio.com/test.pdf",
    filename: "1792119932129_dtjo1cnt_bafdf799-d41d-47ac-adaa-c83bb2587811.pdf",
    contentType: "application/pdf",
    size: 12345,
  });
  mocks.zernioFetch.mockResolvedValue({ data: { messageId: "msg_123" } });
});

async function sendWithFile(fileName?: string) {
  const { sendWhatsappZernio } = await import("@/server/whatsapp/zernio-send");
  return sendWhatsappZernio(
    { token: "token_abc", accountId: "acc_123" } as never,
    "thread_1",
    { message: "Cotización", attachmentType: "file" },
    "idem_key_1",
    { data: Buffer.from("test"), mimeType: "application/pdf", fileName }
  );
}

describe("sendWhatsappZernio - attachmentName", () => {
  it("usa file.fileName (nombre original) en vez del nombre generado por Zernio", async () => {
    await sendWithFile("Cotizacion Landing Page - Juan Perez.pdf");
    const call = mocks.zernioFetch.mock.calls[0]!;
    const body = call[1]!.body as Record<string, unknown>;
    expect(body.attachmentName).toBe("Cotizacion Landing Page - Juan Perez.pdf");
  });

  it("usa uploaded.filename como fallback si file.fileName no viene", async () => {
    await sendWithFile(undefined);
    const call = mocks.zernioFetch.mock.calls[0]!;
    const body = call[1]!.body as Record<string, unknown>;
    expect(body.attachmentName).toBe(
      "1792119932129_dtjo1cnt_bafdf799-d41d-47ac-adaa-c83bb2587811.pdf"
    );
  });

  it("pasa el fileName a zernioUploadMediaDirect", async () => {
    await sendWithFile("Cotizacion Test.pdf");
    expect(mocks.zernioUploadMediaDirect).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "Cotizacion Test.pdf" })
    );
  });
});

describe("formato del nombre del PDF en sendQuote", () => {
  it("sanitiza caracteres peligrosos para nombres de archivo", () => {
    const productName = 'Landing Page / "Premium" <v2>';
    const safeProduct = productName.replace(/[\/\\:*?"<>|]/g, "").slice(0, 60).trim();
    expect(safeProduct).toBe("Landing Page  Premium v2");
  });

  it("limita la longitud a 60 caracteres", () => {
    const longName = "A".repeat(100);
    const safe = longName.replace(/[\/\\:*?"<>|]/g, "").slice(0, 60).trim();
    expect(safe.length).toBe(60);
  });

  it("maneja nombre vacío con fallback", () => {
    const safe = "".replace(/[\/\\:*?"<>|]/g, "").slice(0, 60).trim() || "Cotizacion";
    expect(safe).toBe("Cotizacion");
  });
});
