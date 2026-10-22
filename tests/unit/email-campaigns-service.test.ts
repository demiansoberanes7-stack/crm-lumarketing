import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmailAudienceError } from "@/server/email-campaigns/audience";
import {
  createEmailCampaign,
  EmailCampaignError,
  listEmailCampaigns,
} from "@/server/email-campaigns/service";
import type { EmailRecipient } from "@/server/email-campaigns/recipients";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  resolveEmailAudience: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));

vi.mock("@/server/email-campaigns/audience", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/email-campaigns/audience")>()),
  resolveEmailAudience: mocks.resolveEmailAudience,
}));

let senderRows: unknown[] = [];
let campaignRows: unknown[] = [];
const inserts: { table: unknown; values: unknown }[] = [];

function thenable(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "orderBy", "leftJoin"]) {
    chain[method] = vi.fn(() => chain);
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const select = vi.fn((fields: Record<string, unknown>) => {
  // `listEmailCampaigns` pide varias columnas; el alta del remitente pide tres.
  const rows = "senderEmail" in fields || "createdAt" in fields ? campaignRows : senderRows;
  return thenable(rows);
});

const tx = {
  insert: vi.fn((table: unknown) => ({
    values: (values: unknown) => {
      inserts.push({ table, values });
      return Promise.resolve();
    },
  })),
};

const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx));

beforeEach(() => {
  mocks.getDb.mockReturnValue({ select, transaction });
  mocks.resolveEmailAudience.mockReset();
  senderRows = [];
  campaignRows = [];
  inserts.length = 0;
  select.mockClear();
  tx.insert.mockClear();
  transaction.mockClear();
});

const data = {
  name: "Promo octubre",
  senderAccountId: "acc_1",
  subject: "Hola {{nombre}}",
  bodyText: "Buen día {{nombre}}",
  audience: { kind: "list" as const, text: "ana@example.com" },
};

function recipients(count: number): EmailRecipient[] {
  return Array.from({ length: count }, (_, index) => ({
    email: `persona${index}@example.com`,
    name: `Persona ${index}`,
    contactId: index % 2 === 0 ? `ct_${index}` : null,
  }));
}

describe("alta de campaña de correo", () => {
  it("una cuenta remitente de otra organización no existe para esta campaña", async () => {
    senderRows = [];
    await expect(
      createEmailCampaign({ organizationId: "org_1", actorUserId: "user_1", data })
    ).rejects.toMatchObject({ code: "sender_not_found", status: 404 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("una cuenta apagada no puede enviar la campaña", async () => {
    senderRows = [{ id: "acc_1", emailAddress: "ventas@lumarketing.digital", enabled: false }];
    await expect(
      createEmailCampaign({ organizationId: "org_1", actorUserId: "user_1", data })
    ).rejects.toMatchObject({ code: "sender_disabled" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("una audiencia vacía no crea una campaña sin destinatarios", async () => {
    senderRows = [{ id: "acc_1", emailAddress: "ventas@lumarketing.digital", enabled: true }];
    mocks.resolveEmailAudience.mockResolvedValue([]);
    await expect(
      createEmailCampaign({ organizationId: "org_1", actorUserId: "user_1", data })
    ).rejects.toMatchObject({ code: "audience_empty" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("propaga el límite de audiencia como error de campaña", async () => {
    senderRows = [{ id: "acc_1", emailAddress: "ventas@lumarketing.digital", enabled: true }];
    mocks.resolveEmailAudience.mockRejectedValue(
      new EmailAudienceError("audience_limit", "La audiencia supera el límite")
    );
    await expect(
      createEmailCampaign({ organizationId: "org_1", actorUserId: "user_1", data })
    ).rejects.toBeInstanceOf(EmailCampaignError);
    await expect(
      createEmailCampaign({ organizationId: "org_1", actorUserId: "user_1", data })
    ).rejects.toMatchObject({ code: "audience_limit" });
  });

  it("guarda la campaña con canal email y sus destinatarios en lotes", async () => {
    senderRows = [{ id: "acc_1", emailAddress: "ventas@lumarketing.digital", enabled: true }];
    mocks.resolveEmailAudience.mockResolvedValue(recipients(501));

    const created = await createEmailCampaign({
      organizationId: "org_1",
      actorUserId: "user_1",
      data,
    });

    expect(created).toMatchObject({ recipientCount: 501, senderEmail: "ventas@lumarketing.digital" });
    const campaignInsert = inserts[0]?.values as Record<string, unknown>;
    expect(campaignInsert).toMatchObject({
      organizationId: "org_1",
      name: "Promo octubre",
      channel: "email",
      senderAccountId: "acc_1",
      subject: "Hola {{nombre}}",
      messageText: "Buen día {{nombre}}",
      status: "draft",
      recipientCount: 501,
      createdBy: "user_1",
      filters: { audienceKind: "list", audienceCount: 501 },
    });

    // 501 destinatarios: un lote de 500 y otro de 1.
    const batches = inserts.slice(1).map((entry) => entry.values as Record<string, unknown>[]);
    expect(batches.map((batch) => batch.length)).toEqual([500, 1]);
    expect(batches[0]?.[0]).toMatchObject({
      organizationId: "org_1",
      campaignId: created.id,
      contactId: "ct_0",
      email: "persona0@example.com",
      recipientName: "Persona 0",
      channel: "email",
      status: "queued",
    });
  });
});

describe("lista de campañas de correo", () => {
  it("serializa fechas y cae a createdAt si no hubo programación", async () => {
    campaignRows = [
      {
        id: "cmp_1",
        name: "Promo",
        subject: "Hola",
        status: "draft",
        senderAccountId: "acc_1",
        senderLabel: "Ventas",
        senderEmail: "ventas@lumarketing.digital",
        recipientCount: 10,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date("2026-10-22T10:00:00.000Z"),
      },
    ];
    const [row] = await listEmailCampaigns("org_1");
    expect(row).toMatchObject({
      scheduledAt: "2026-10-22T10:00:00.000Z",
      startedAt: null,
      completedAt: null,
      senderEmail: "ventas@lumarketing.digital",
    });
  });
});
