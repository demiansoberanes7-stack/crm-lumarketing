import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCredentialsByPhoneNumberId: vi.fn(),
  processMessagesValue: vi.fn(),
  processEchoesValue: vi.fn(),
  processWahaWebhookEvent: vi.fn(),
  getInstagramCredentialsByIgUserId: vi.fn(),
  processMetaInstagramPayload: vi.fn(),
  getMessengerCredentialsByPageId: vi.fn(),
  processMetaPagePayload: vi.fn(),
  resolveZernioSecret: vi.fn(),
  processZernioPayload: vi.fn(),
  getWhatsappZernioByAccount: vi.fn(),
  ingestWhatsappZernio: vi.fn(),
}));

vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByPhoneNumberId: mocks.getCredentialsByPhoneNumberId }));
vi.mock("@/server/inbox/ingest", () => ({
  processMessagesValue: mocks.processMessagesValue,
  processEchoesValue: mocks.processEchoesValue,
}));
vi.mock("@/server/waha/webhook", () => ({ processWahaWebhookEvent: mocks.processWahaWebhookEvent }));
vi.mock("@/server/instagram/credentials", () => ({ getInstagramCredentialsByIgUserId: mocks.getInstagramCredentialsByIgUserId }));
vi.mock("@/server/instagram/ingest", () => ({ processMetaInstagramPayload: mocks.processMetaInstagramPayload }));
vi.mock("@/server/messenger/credentials", () => ({ getMessengerCredentialsByPageId: mocks.getMessengerCredentialsByPageId }));
vi.mock("@/server/messenger/ingest", () => ({ processMetaPagePayload: mocks.processMetaPagePayload }));
vi.mock("@/server/zernio/dispatch", () => ({
  resolveZernioSecret: mocks.resolveZernioSecret,
  processZernioPayload: mocks.processZernioPayload,
}));
vi.mock("@/server/whatsapp/zernio-credentials", () => ({ getWhatsappZernioByAccount: mocks.getWhatsappZernioByAccount }));
vi.mock("@/server/whatsapp/zernio-ingest", () => ({
  whatsappZernioEvent: { safeParse: (data: unknown) => ({ success: true, data }) },
  ingestWhatsappZernio: mocks.ingestWhatsappZernio,
}));

import { processInboundWebhookEvent } from "@/server/webhooks/inbound-dispatch";

function event(provider: string, organizationId: string, payload: unknown) {
  return {
    id: "whev_1",
    organizationId,
    provider,
    eventType: "test.event",
    rawBody: JSON.stringify(payload),
  } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCredentialsByPhoneNumberId.mockResolvedValue({ organizationId: "org_1" });
  mocks.getInstagramCredentialsByIgUserId.mockResolvedValue({ organizationId: "org_1", source: "meta" });
  mocks.getMessengerCredentialsByPageId.mockResolvedValue({ organizationId: "org_1", source: "meta" });
  mocks.resolveZernioSecret.mockResolvedValue({ organizationId: "org_1", channel: "instagram", accountRef: "acc_1", secret: "secret" });
  mocks.getWhatsappZernioByAccount.mockResolvedValue({ organizationId: "org_1", accountId: "acc_1" });
});

describe("dispatcher de eventos durables", () => {
  it("reutiliza la ingesta Meta y pide que errores por item se devuelvan para reintento", async () => {
    const payload = {
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "pn_1" }, messages: [{ id: "wamid_1" }] } }] }],
    };

    await processInboundWebhookEvent(event("meta_whatsapp", "org_1", payload));

    expect(mocks.processMessagesValue).toHaveBeenCalledWith(
      payload.entry[0]?.changes[0]?.value,
      { retryOnItemError: true }
    );
  });

  it("no entrega a un tenant si el ID del proveedor ya no le pertenece", async () => {
    mocks.getCredentialsByPhoneNumberId.mockResolvedValue({ organizationId: "org_other" });
    const payload = {
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "pn_1" }, messages: [{ id: "wamid_1" }] } }] }],
    };

    await processInboundWebhookEvent(event("meta_whatsapp", "org_1", payload));

    expect(mocks.processMessagesValue).not.toHaveBeenCalled();
  });

  it("el reintento WAHA procesa con el organizationId guardado, no con el token original", async () => {
    const payload = { event: "message.any", session: "default", payload: { id: "mid_1" } };

    await processInboundWebhookEvent(event("waha", "org_1", payload));

    expect(mocks.processWahaWebhookEvent).toHaveBeenCalledWith("org_1", payload);
  });

  it("los procesadores sociales de Zernio reciben un modo que propaga fallos para reintento", async () => {
    const payload = { event: "message.received", account: { id: "acc_1", platform: "instagram" } };

    await processInboundWebhookEvent(event("zernio_instagram", "org_1", payload));

    expect(mocks.processZernioPayload).toHaveBeenCalledWith(payload, { retryOnItemError: true });
  });

  it("Zernio WhatsApp verifica que la cuenta no haya cambiado de organización", async () => {
    mocks.getWhatsappZernioByAccount.mockResolvedValue({ organizationId: "org_other", accountId: "acc_1" });
    const payload = {
      event: "message.received",
      account: { accountId: "acc_1", platform: "whatsapp" },
      message: { platformMessageId: "pmid_1" },
    };

    await processInboundWebhookEvent(event("zernio_whatsapp", "org_1", payload));

    expect(mocks.ingestWhatsappZernio).not.toHaveBeenCalled();
  });
});
