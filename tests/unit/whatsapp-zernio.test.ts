import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validWhatsappZernioSignature, whatsappZernioIdentity } from "@/server/whatsapp/zernio-ingest";
import { sendWhatsappZernio, zernioMessageId } from "@/server/whatsapp/zernio-send";
const creds = { organizationId: "org", accountId: "account", token: "secret-token", webhookSecret: "secret", displayPhone: "+525555555555" };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("WhatsApp Zernio", () => {
  it("requiere firma exacta del cuerpo crudo y rechaza firma ausente o alterada", () => {
    const raw = '{"event":"message.received"}';
    const signature = createHmac("sha256", "secret").update(raw).digest("hex");
    expect(validWhatsappZernioSignature(raw, signature, "secret")).toBe(true);
    expect(validWhatsappZernioSignature(raw + " ", signature, "secret")).toBe(false);
    expect(validWhatsappZernioSignature(raw, null, "secret")).toBe(false);
  });
  it("no confunde un BSUID numérico con un teléfono y normaliza México", () => {
    expect(whatsappZernioIdentity({ id: "1234567890", businessScopedUserId: "1234567890" })).toMatchObject({ identity: "bsuid:1234567890", phone: null });
    expect(whatsappZernioIdentity({ id: "5215512345678", phoneNumber: "+5215512345678" })).toMatchObject({ phone: "525512345678" });
  });
  it("envía por el contrato oficial y conserva el wamid para los acuses", async () => {
    vi.stubEnv("WHATSAPP_ZERNIO_ENABLED", "true");
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: { messageId: "wamid.1" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await sendWhatsappZernio(creds, "thread/1", { message: "Hola" }, "msg_1")).toBe("wamid.1");
    expect(fetch.mock.calls[0]![0]).toContain("/inbox/conversations/thread%2F1/messages");
    const opts = fetch.mock.calls[0]![1];
    expect(JSON.parse(opts.body)).toEqual({ accountId: "account", message: "Hola" });
    expect(opts.headers["Idempotency-Key"]).toBe("msg_1");
  });
  it("sube adjuntos por upload-direct y envía la URL pública en el mensaje JSON", async () => {
    vi.stubEnv("WHATSAPP_ZERNIO_ENABLED", "true");
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ url: "https://media.zernio.com/temp/banner.jpg", filename: "banner.jpg", contentType: "image/jpeg", size: 313000 }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { messageId: "wamid.media" } }));
    vi.stubGlobal("fetch", fetch);

    const result = await sendWhatsappZernio(
      creds,
      "thread/1",
      { message: "Servicio de mantenimiento", attachmentType: "image" },
      "msg_media_1",
      { data: Buffer.from("jpeg"), mimeType: "image/jpeg", fileName: "banner.jpg" }
    );

    expect(result).toBe("wamid.media");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/media/upload-direct");
    const upload = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(upload.body).toBeInstanceOf(FormData);
    expect((upload.body as FormData).get("contentType")).toBe("image/jpeg");
    expect(String(fetch.mock.calls[1]?.[0])).toContain("/inbox/conversations/thread%2F1/messages");
    const send = fetch.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(send.body))).toEqual({
      accountId: "account",
      message: "Servicio de mantenimiento",
      attachmentType: "image",
      attachmentUrl: "https://media.zernio.com/temp/banner.jpg",
    });
    expect((send.headers as Record<string, string>)["Idempotency-Key"]).toBe("msg_media_1");
  });
  it("preserva el código de error de Zernio cuando la subida o envío devuelve 400", async () => {
    vi.stubEnv("WHATSAPP_ZERNIO_ENABLED", "true");
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: "Invalid attachment URL", type: "invalid_request_error", code: "invalid_field_value", param: "attachmentUrl" }, { status: 400 }));
    vi.stubGlobal("fetch", fetch);

    await expect(sendWhatsappZernio(
      creds,
      "thread/1",
      { message: "caption", attachmentType: "image" },
      "msg_media_2",
      { data: Buffer.from("jpeg"), mimeType: "image/jpeg", fileName: "banner.jpg" }
    )).rejects.toMatchObject({
      status: 400,
      message: "Invalid attachment URL",
      details: { code: "invalid_field_value", param: "attachmentUrl" },
    });
  });
  it("apagado no toca red; sin hilo no inventa identificadores", async () => {
    vi.stubEnv("WHATSAPP_ZERNIO_ENABLED", "false");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(sendWhatsappZernio(creds, "thread", { message: "Hola" }, "key")).rejects.toThrow("desactivado");
    vi.stubEnv("WHATSAPP_ZERNIO_ENABLED", "true");
    await expect(sendWhatsappZernio(creds, null, { message: "Hola" }, "key")).rejects.toThrow("mensaje entrante");
    expect(fetch).not.toHaveBeenCalled();
    expect(() => zernioMessageId({ success: true })).toThrow("identificador");
  });
  it("un 401 o 503 del proveedor falla sin enviar reintentos duplicados", async () => {
    vi.stubEnv("WHATSAPP_ZERNIO_ENABLED", "true");
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 503 })); vi.stubGlobal("fetch", fetch);
    await expect(sendWhatsappZernio(creds, "thread", { message: "Hola" }, "key")).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
