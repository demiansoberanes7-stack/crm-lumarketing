import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  getEnv: vi.fn(),
  checkDistributedRateLimit: vi.fn(),
  requestClientKey: vi.fn(),
  isValidWebhookToken: vi.fn(),
  isValidSignature: vi.fn(),
  isValidZernioSignature: vi.fn(),
  zernioSignatureFrom: vi.fn(),
  resolveZernioSecret: vi.fn(),
  isChannelEnabled: vi.fn(),
  channelDisabledResponse: vi.fn(),
  looksLikeMetaPayload: vi.fn(),
  zernioWhatsappEnabled: vi.fn(),
  zernioWhatsappWebhookUrl: vi.fn(),
  getWhatsappZernioByAccount: vi.fn(),
  validWhatsappZernioSignature: vi.fn(),
  persistMetaWhatsAppPayload: vi.fn(),
  persistWahaPayload: vi.fn(),
  persistMetaInstagramPayload: vi.fn(),
  persistMetaMessengerPayload: vi.fn(),
  persistZernioPayload: vi.fn(),
  persistZernioWhatsAppPayload: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/lib/http/body", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http/body")>()),
  requestClientKey: mocks.requestClientKey,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkDistributedRateLimit: mocks.checkDistributedRateLimit,
  WEBHOOK_RATE_LIMIT: { windowMs: 60_000, max: 120 },
}));
vi.mock("@/server/inbox/webhook", () => ({
  isValidWebhookToken: mocks.isValidWebhookToken,
  isValidSignature: mocks.isValidSignature,
}));
vi.mock("@/server/zernio", () => ({
  isValidZernioSignature: mocks.isValidZernioSignature,
  zernioSignatureFrom: mocks.zernioSignatureFrom,
  looksLikeMetaPayload: mocks.looksLikeMetaPayload,
}));
vi.mock("@/server/zernio/dispatch", () => ({ resolveZernioSecret: mocks.resolveZernioSecret }));
vi.mock("@/server/channels/enabled", () => ({
  isChannelEnabled: mocks.isChannelEnabled,
  channelDisabledResponse: mocks.channelDisabledResponse,
}));
vi.mock("@/server/whatsapp/zernio-credentials", () => ({
  zernioWhatsappEnabled: mocks.zernioWhatsappEnabled,
  zernioWhatsappWebhookUrl: mocks.zernioWhatsappWebhookUrl,
  getWhatsappZernioByAccount: mocks.getWhatsappZernioByAccount,
}));
vi.mock("@/server/whatsapp/zernio-ingest", () => ({
  whatsappZernioEvent: { safeParse: (payload: unknown) => ({ success: true, data: payload }) },
  validWhatsappZernioSignature: mocks.validWhatsappZernioSignature,
}));
vi.mock("@/server/webhooks/inbound-ingress", () => ({
  persistMetaWhatsAppPayload: mocks.persistMetaWhatsAppPayload,
  persistWahaPayload: mocks.persistWahaPayload,
  persistMetaInstagramPayload: mocks.persistMetaInstagramPayload,
  persistMetaMessengerPayload: mocks.persistMetaMessengerPayload,
  persistZernioPayload: mocks.persistZernioPayload,
  persistZernioWhatsAppPayload: mocks.persistZernioWhatsAppPayload,
}));

import { POST as postWhatsApp } from "@/app/api/webhooks/wa/[webhookToken]/route";
import { POST as postWaha } from "@/app/api/webhooks/waha/[token]/route";
import { POST as postInstagram } from "@/app/api/webhooks/ig/[webhookToken]/route";
import { POST as postMessenger } from "@/app/api/webhooks/messenger/[webhookToken]/route";
import { POST as postZernioWhatsApp } from "@/app/api/webhooks/zernio-whatsapp/[token]/route";

const ok = () => Promise.resolve({ queued: 1, ignored: 0 });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.after.mockImplementation(() => undefined);
  mocks.getEnv.mockReturnValue({ META_WEBHOOK_VERIFY_TOKEN: "test-verify", META_APP_SECRET: "" });
  mocks.checkDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 100 });
  mocks.requestClientKey.mockReturnValue("127.0.0.1");
  mocks.isValidWebhookToken.mockReturnValue(true);
  mocks.isValidSignature.mockReturnValue(true);
  mocks.isValidZernioSignature.mockReturnValue(true);
  mocks.zernioSignatureFrom.mockReturnValue("signature");
  mocks.resolveZernioSecret.mockResolvedValue({ secret: "secret", accountRef: "acc_1", channel: "instagram" });
  mocks.isChannelEnabled.mockReturnValue(true);
  mocks.channelDisabledResponse.mockReturnValue(new Response(null, { status: 404 }));
  mocks.looksLikeMetaPayload.mockReturnValue(true);
  mocks.zernioWhatsappEnabled.mockReturnValue(true);
  mocks.zernioWhatsappWebhookUrl.mockReturnValue("https://crm.local/api/webhooks/zernio-whatsapp/token");
  mocks.getWhatsappZernioByAccount.mockResolvedValue({ organizationId: "org_1", webhookSecret: "secret" });
  mocks.validWhatsappZernioSignature.mockReturnValue(true);
  for (const persist of [
    mocks.persistMetaWhatsAppPayload,
    mocks.persistWahaPayload,
    mocks.persistMetaInstagramPayload,
    mocks.persistMetaMessengerPayload,
    mocks.persistZernioPayload,
    mocks.persistZernioWhatsAppPayload,
  ]) persist.mockImplementation(ok);
});

function request(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectAckAfterPersist(responsePromise: Promise<Response>, persist: ReturnType<typeof vi.fn>) {
  const response = await responsePromise;
  expect(response.status).toBe(200);
  expect(persist).toHaveBeenCalledTimes(1);
  expect(mocks.after).not.toHaveBeenCalled();
}

describe("webhook routes persist before ACK", () => {
  it("WhatsApp Meta waits for durable receipt", async () => {
    await expectAckAfterPersist(
      postWhatsApp(request("https://crm.local/api/webhooks/wa/test-verify", { entry: [] }), {
        params: Promise.resolve({ webhookToken: "test-verify" }),
      }),
      mocks.persistMetaWhatsAppPayload
    );
  });

  it("WAHA waits for durable receipt", async () => {
    await expectAckAfterPersist(
      postWaha(request("https://crm.local/api/webhooks/waha/token", { event: "message.any", payload: {} }) as never, {
        params: Promise.resolve({ token: "token" }),
      }),
      mocks.persistWahaPayload
    );
  });

  it("Instagram Meta waits for durable receipt", async () => {
    await expectAckAfterPersist(
      postInstagram(request("https://crm.local/api/webhooks/ig/test-verify", { object: "instagram", entry: [] }), {
        params: Promise.resolve({ webhookToken: "test-verify" }),
      }),
      mocks.persistMetaInstagramPayload
    );
  });

  it("Instagram Zernio waits for durable receipt after its account signature", async () => {
    mocks.looksLikeMetaPayload.mockReturnValue(false);
    await expectAckAfterPersist(
      postInstagram(request("https://crm.local/api/webhooks/ig/test-verify", {
        event: "message.received",
        account: { id: "acc_1", platform: "instagram" },
      }), { params: Promise.resolve({ webhookToken: "test-verify" }) }),
      mocks.persistZernioPayload
    );
  });

  it("Messenger Meta waits for durable receipt", async () => {
    await expectAckAfterPersist(
      postMessenger(request("https://crm.local/api/webhooks/messenger/test-verify", { object: "page", entry: [] }), {
        params: Promise.resolve({ webhookToken: "test-verify" }),
      }),
      mocks.persistMetaMessengerPayload
    );
  });

  it("Messenger Zernio waits for durable receipt after its account signature", async () => {
    mocks.looksLikeMetaPayload.mockReturnValue(false);
    mocks.resolveZernioSecret.mockResolvedValue({ secret: "secret", accountRef: "acc_1", channel: "messenger" });
    await expectAckAfterPersist(
      postMessenger(request("https://crm.local/api/webhooks/messenger/test-verify", {
        event: "message.received",
        account: { id: "acc_1", platform: "facebook" },
      }), { params: Promise.resolve({ webhookToken: "test-verify" }) }),
      mocks.persistZernioPayload
    );
  });

  it("Zernio WhatsApp waits for durable receipt rather than running ingest in-request", async () => {
    await expectAckAfterPersist(
      postZernioWhatsApp(request("https://crm.local/api/webhooks/zernio-whatsapp/token", {
        event: "message.received",
        account: { accountId: "acc_1", platform: "whatsapp" },
        message: { platformMessageId: "pmsg_1" },
      }), { params: Promise.resolve({ token: "token" }) }),
      mocks.persistZernioWhatsAppPayload
    );
  });

  it("if durable storage is unavailable, does not ACK Zernio WhatsApp", async () => {
    mocks.persistZernioWhatsAppPayload.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await postZernioWhatsApp(request("https://crm.local/api/webhooks/zernio-whatsapp/token", {
      event: "message.received",
      account: { accountId: "acc_1", platform: "whatsapp" },
      message: { platformMessageId: "pmsg_1" },
    }), { params: Promise.resolve({ token: "token" }) });

    expect(response.status).toBe(503);
  });

  it("Meta rejects an invalid signature without persisting the payload", async () => {
    mocks.isValidSignature.mockReturnValue(false);

    const response = await postWhatsApp(
      request("https://crm.local/api/webhooks/wa/test-verify", { entry: [] }),
      { params: Promise.resolve({ webhookToken: "test-verify" }) }
    );

    expect(response.status).toBe(401);
    expect(mocks.persistMetaWhatsAppPayload).not.toHaveBeenCalled();
  });

  it("Zernio WhatsApp rejects an invalid signature without persisting the payload", async () => {
    mocks.validWhatsappZernioSignature.mockReturnValue(false);

    const response = await postZernioWhatsApp(
      request("https://crm.local/api/webhooks/zernio-whatsapp/token", {
        event: "message.received",
        account: { accountId: "acc_1", platform: "whatsapp" },
        message: { platformMessageId: "pmsg_1" },
      }),
      { params: Promise.resolve({ token: "token" }) }
    );

    expect(response.status).toBe(401);
    expect(mocks.persistZernioWhatsAppPayload).not.toHaveBeenCalled();
  });
});
