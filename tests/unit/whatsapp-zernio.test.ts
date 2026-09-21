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
