import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCredentialsByPhoneNumberId: vi.fn(),
  getInstagramCredentialsByIgUserId: vi.fn(),
  getMessengerCredentialsByPageId: vi.fn(),
  getWahaOrganizationByWebhookToken: vi.fn(),
  getWhatsappZernioByAccount: vi.fn(),
  resolveZernioSecret: vi.fn(),
  enqueueInboundWebhook: vi.fn(),
}));

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByPhoneNumberId: mocks.getCredentialsByPhoneNumberId,
}));
vi.mock("@/server/instagram/credentials", () => ({
  getInstagramCredentialsByIgUserId: mocks.getInstagramCredentialsByIgUserId,
}));
vi.mock("@/server/messenger/credentials", () => ({
  getMessengerCredentialsByPageId: mocks.getMessengerCredentialsByPageId,
}));
vi.mock("@/server/waha/webhook", () => ({
  getWahaOrganizationByWebhookToken: mocks.getWahaOrganizationByWebhookToken,
}));
vi.mock("@/server/whatsapp/zernio-credentials", () => ({
  getWhatsappZernioByAccount: mocks.getWhatsappZernioByAccount,
}));
vi.mock("@/server/zernio/dispatch", () => ({ resolveZernioSecret: mocks.resolveZernioSecret }));
vi.mock("@/server/webhooks/inbound-queue", () => ({
  enqueueInboundWebhook: mocks.enqueueInboundWebhook,
  inboundWebhookEventKey: (provider: string, organizationId: string, identity: string) =>
    `${provider}:${organizationId}:${identity}`,
  inboundWebhookPayloadKey: (provider: string, organizationId: string, body: string) =>
    `${provider}:${organizationId}:${body}`,
}));

import {
  persistMetaInstagramPayload,
  persistMetaMessengerPayload,
  persistMetaWhatsAppPayload,
  persistWahaPayload,
  persistZernioPayload,
  persistZernioWhatsAppPayload,
} from "@/server/webhooks/inbound-ingress";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enqueueInboundWebhook.mockResolvedValue({ persisted: true, duplicate: false });
  mocks.getCredentialsByPhoneNumberId.mockImplementation(async (phoneNumberId: string) => ({
    organizationId: phoneNumberId === "pn_a" ? "org_a" : "org_b",
  }));
  mocks.getInstagramCredentialsByIgUserId.mockImplementation(async (igUserId: string) => ({
    organizationId: igUserId === "ig_a" ? "org_a" : "org_b",
    source: "meta",
  }));
  mocks.getMessengerCredentialsByPageId.mockImplementation(async (pageId: string) => ({
    organizationId: pageId === "page_a" ? "org_a" : "org_b",
    source: "meta",
  }));
  mocks.getWahaOrganizationByWebhookToken.mockResolvedValue("org_waha");
  mocks.getWhatsappZernioByAccount.mockResolvedValue({ organizationId: "org_zw", accountId: "acc_zw" });
  mocks.resolveZernioSecret.mockResolvedValue({
    secret: "unit-test-signing-secret",
    accountRef: "acc_social",
    organizationId: "org_social",
    channel: "instagram",
  });
});

describe("persistencia de entrada por proveedor y tenant", () => {
  it("parte batches de WhatsApp Meta por cambio y enruta cada fila a su negocio", async () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        { id: "waba_a", changes: [{ field: "messages", value: { metadata: { phone_number_id: "pn_a" }, messages: [{ id: "wamid_a" }] } }] },
        { id: "waba_b", changes: [{ field: "messages", value: { metadata: { phone_number_id: "pn_b" }, messages: [{ id: "wamid_b" }] } }] },
      ],
    });

    const result = await persistMetaWhatsAppPayload(raw);

    expect(result).toEqual({ queued: 2, ignored: 0 });
    expect(mocks.enqueueInboundWebhook).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueInboundWebhook.mock.calls.map(([input]) => (input as { organizationId: string }).organizationId))
      .toEqual(["org_a", "org_b"]);
    const bodies = mocks.enqueueInboundWebhook.mock.calls.map(([input]) => JSON.parse((input as { rawBody: string }).rawBody));
    expect(bodies.every((body) => body.entry.length === 1 && body.entry[0].changes.length === 1)).toBe(true);
    expect(bodies[0].entry[0].changes[0].value.messages[0].id).toBe("wamid_a");
    expect(bodies[1].entry[0].changes[0].value.messages[0].id).toBe("wamid_b");
  });

  it("deduplica identidades de evento de Meta y preserva wa_message_id en el payload", async () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "waba_a", changes: [{ field: "messages", value: { metadata: { phone_number_id: "pn_a" }, messages: [{ id: "wamid_same" }] } }] }],
    });

    await persistMetaWhatsAppPayload(raw);
    await persistMetaWhatsAppPayload(raw);

    expect(mocks.enqueueInboundWebhook.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org_a",
      provider: "meta_whatsapp",
      rawBody: expect.stringContaining("wamid_same"),
    });
    const first = mocks.enqueueInboundWebhook.mock.calls[0]?.[0] as { idempotencyKey: string };
    const second = mocks.enqueueInboundWebhook.mock.calls[1]?.[0] as { idempotencyKey: string };
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
  });

  it("parte eventos de Instagram y Messenger Meta por entry propietario", async () => {
    const instagram = JSON.stringify({
      object: "instagram",
      entry: [{ id: "ig_a", messaging: [{ message: { mid: "ig_mid" } }] }],
    });
    const messenger = JSON.stringify({
      object: "page",
      entry: [{ id: "page_a", messaging: [{ message: { mid: "fb_mid" } }] }],
    });

    expect(await persistMetaInstagramPayload(instagram)).toEqual({ queued: 1, ignored: 0 });
    expect(await persistMetaMessengerPayload(messenger)).toEqual({ queued: 1, ignored: 0 });
    expect(mocks.enqueueInboundWebhook.mock.calls.map(([input]) => (input as { organizationId: string; provider: string }).organizationId + ":" + (input as { provider: string }).provider))
      .toEqual(["org_a:meta_instagram", "org_a:meta_messenger"]);
  });

  it("asocia WAHA al tenant del token sin guardar el token en el evento", async () => {
    const raw = JSON.stringify({ event: "message.any", session: "default", payload: { id: "waha_mid" } });

    expect(await persistWahaPayload("secret-url-token", raw)).toEqual({ queued: 1, ignored: 0 });
    expect(mocks.enqueueInboundWebhook).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_waha",
      provider: "waha",
      rawBody: raw,
    }));
    expect(JSON.stringify(mocks.enqueueInboundWebhook.mock.calls[0]?.[0])).not.toContain("secret-url-token");
  });

  it("descarta un token WAHA que no resuelve tenant sin guardar el evento", async () => {
    mocks.getWahaOrganizationByWebhookToken.mockResolvedValue(null);

    const result = await persistWahaPayload(
      "unknown-token",
      JSON.stringify({ event: "message.any", payload: { id: "unknown_mid" } })
    );

    expect(result).toEqual({ queued: 0, ignored: 1 });
    expect(mocks.enqueueInboundWebhook).not.toHaveBeenCalled();
  });

  it("resuelve y persiste los canales sociales compartidos de Zernio", async () => {
    const raw = JSON.stringify({ event: "message.received", account: { id: "acc_social", platform: "instagram" }, message: { id: "msg_1" } });

    expect(await persistZernioPayload(raw)).toEqual({ queued: 1, ignored: 0 });
    expect(mocks.enqueueInboundWebhook).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_social",
      provider: "zernio_instagram",
      rawBody: raw,
    }));
  });

  it("resuelve la organización de Zernio WhatsApp por cuenta y no mete credenciales en el body", async () => {
    const raw = JSON.stringify({ event: "message.received", account: { accountId: "acc_zw", platform: "whatsapp" }, message: { platformMessageId: "pmsg_1" } });

    const event = JSON.parse(raw) as Parameters<typeof persistZernioWhatsAppPayload>[2];
    expect(await persistZernioWhatsAppPayload(
      raw,
      {
        organizationId: "org_zw",
        accountId: "acc_zw",
        token: "test-token",
        webhookSecret: "test-secret",
        displayPhone: "test-phone",
      },
      event
    )).toEqual({ queued: 1, ignored: 0 });
    expect(mocks.enqueueInboundWebhook).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_zw",
      provider: "zernio_whatsapp",
      rawBody: raw,
    }));
  });
});
