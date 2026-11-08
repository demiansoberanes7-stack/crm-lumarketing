import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCredentialsByPhoneNumberId: vi.fn(),
  applyStatusUpdate: vi.fn(),
  whatsappProvider: vi.fn(),
}));

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByPhoneNumberId: mocks.getCredentialsByPhoneNumberId,
}));
vi.mock("@/server/inbox/status", () => ({ applyStatusUpdate: mocks.applyStatusUpdate }));
vi.mock("@/server/whatsapp/provider", () => ({ whatsappProvider: mocks.whatsappProvider }));

import { processMessagesValue } from "@/server/inbox/ingest";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCredentialsByPhoneNumberId.mockResolvedValue({ organizationId: "org_1" });
  mocks.applyStatusUpdate.mockRejectedValue(new Error("fallo temporal al actualizar estado"));
  mocks.whatsappProvider.mockResolvedValue("waha");
});

describe("reintento de errores al procesar estados durables de WhatsApp", () => {
  it("propaga el fallo de un status aunque WhatsApp ya use WAHA", async () => {
    await expect(
      processMessagesValue(
        {
          metadata: { phone_number_id: "pn_1" },
          statuses: [{ id: "wamid_1", status: "delivered", timestamp: "1700000000" }],
        },
        { retryOnItemError: true }
      )
    ).rejects.toThrow("1 elemento(s) del webhook WhatsApp no se procesaron");

    expect(mocks.applyStatusUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.whatsappProvider).toHaveBeenCalledWith("org_1");
  });
});
