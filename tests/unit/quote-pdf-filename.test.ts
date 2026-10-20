import { beforeEach, describe, expect, it, vi } from "vitest";
import { quotePdfFileName } from "@/server/quotes/filename";

/**
 * Nombre del archivo PDF enviado por WhatsApp.
 *
 * El bug original: Zernio devolvía un nombre generado (timestamp + UUID) que
 * WhatsApp mostraba en el chat. Enviar `attachmentName` en JSON no lo
 * corregía; el documento debe salir por multipart, donde Zernio usa el nombre
 * del archivo subido.
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

describe("sendWhatsappZernio - nombre del documento", () => {
  it("envía el PDF por multipart con el nombre real del cliente", async () => {
    await sendWithFile("Cotizacion Landing Page - Juan Perez.pdf");
    const call = mocks.zernioFetch.mock.calls[0]!;
    expect(call[1]!.body).toBeUndefined();
    const form = call[1]!.formData as FormData;
    expect(form.get("accountId")).toBe("acc_123");
    expect(form.get("message")).toBe("Cotización");
    const attachment = form.get("attachment") as File;
    expect(attachment.name).toBe("Cotizacion Landing Page - Juan Perez.pdf");
    expect(attachment.type).toBe("application/pdf");
    expect(mocks.zernioUploadMediaDirect).not.toHaveBeenCalled();
  });

  it("usa un nombre de respaldo si file.fileName no viene", async () => {
    await sendWithFile(undefined);
    const form = mocks.zernioFetch.mock.calls[0]![1]!.formData as FormData;
    expect((form.get("attachment") as File).name).toBe("documento.pdf");
  });
});

describe("quotePdfFileName (código real)", () => {
  it("arma nombre producto - cliente", () => {
    expect(quotePdfFileName("Landing Page", "Juan Perez")).toBe(
      "Cotizacion Landing Page - Juan Perez.pdf"
    );
  });

  it("sanitiza caracteres peligrosos para nombres de archivo", () => {
    expect(quotePdfFileName('Landing Page / "Premium" <v2>', "Ana/Maria")).toBe(
      "Cotizacion Landing Page  Premium v2 - AnaMaria.pdf"
    );
  });

  it("limita cada segmento a 60 caracteres", () => {
    const name = quotePdfFileName("A".repeat(100), "B".repeat(100));
    const [product, contact] = name.replace(/\.pdf$/, "").split(" - ");
    expect(product!.length - "Cotizacion ".length).toBe(60);
    expect(contact!.length).toBe(60);
  });

  it("usa fallbacks cuando los segmentos quedan vacíos tras sanitizar", () => {
    expect(quotePdfFileName("", '""')).toBe("Cotizacion Cotizacion - Cliente.pdf");
  });
});
