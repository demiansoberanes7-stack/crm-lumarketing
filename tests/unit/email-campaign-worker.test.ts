import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  sendEmail: vi.fn(),
  refreshBroadcastCampaign: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));

vi.mock("@/server/email/service", () => ({
  CUENTA_MUDA: "La cuenta de correo está apagada.",
  sendEmail: mocks.sendEmail,
}));

vi.mock("@/server/broadcasts/metrics", () => ({
  refreshBroadcastCampaign: mocks.refreshBroadcastCampaign,
}));

vi.mock("@/server/inbox/send", () => ({
  SendError: class SendError extends Error {},
  sendTemplate: vi.fn(),
  sendText: vi.fn(),
}));

let dueRows: Record<string, unknown>[] = [];
let campaignStatus = "sending";
let senderRow: { enabled: boolean; dailyLimit: number } | null = { enabled: true, dailyLimit: 100 };
let sentToday = 0;
const updates: Record<string, unknown>[] = [];

function thenable(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const select = vi.fn((fields: Record<string, unknown>) => {
  if ("subject" in fields) return thenable(dueRows);
  if ("status" in fields) return thenable([{ status: campaignStatus }]);
  if ("dailyLimit" in fields) return thenable(senderRow ? [senderRow] : []);
  if ("total" in fields) return thenable([{ total: sentToday }]);
  return thenable([]);
});

const update = vi.fn(() => ({
  set: (values: Record<string, unknown>) => {
    updates.push(values);
    const afterWhere = Promise.resolve([{ id: "rcp_1" }]) as Promise<unknown[]> & {
      returning?: () => Promise<unknown[]>;
    };
    afterWhere.returning = () => Promise.resolve([{ id: "rcp_1" }]);
    return { where: vi.fn(() => afterWhere) };
  },
}));

function emailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rcp_1",
    organizationId: "org_1",
    campaignId: "cmp_1",
    conversationId: null,
    contactId: "ct_1",
    email: "Ana@Example.com",
    recipientName: "Ana",
    channel: "email",
    subject: "Hola {{nombre}}",
    senderAccountId: "acc_1",
    messageText: "Buen día {{nombre}}, tu correo es {{correo}}",
    templateName: null,
    templateLanguage: null,
    templateParams: null,
    templateCategory: null,
    templateHeaderFormat: null,
    templateHeaderMediaUrl: null,
    contactOptInAt: null,
    ...overrides,
  };
}

const { runBroadcastWorkerOnce } = await import("@/server/broadcast-queue");

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  dueRows = [emailRow()];
  campaignStatus = "sending";
  senderRow = { enabled: true, dailyLimit: 100 };
  sentToday = 0;
  updates.length = 0;
  select.mockClear();
  update.mockClear();
  mocks.sendEmail.mockReset();
  mocks.sendEmail.mockResolvedValue("msg_9");
  mocks.refreshBroadcastCampaign.mockReset();
  mocks.getDb.mockReturnValue({ select, update });
});

describe("worker de campañas de correo", () => {
  it("envía sin conversación y personaliza asunto y cuerpo por destinatario", async () => {
    await runBroadcastWorkerOnce();

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith("org_1", "acc_1", {
      to: "ana@example.com",
      subject: "Hola Ana",
      text: "Buen día Ana, tu correo es ana@example.com",
      contactId: "ct_1",
      campaignId: "cmp_1",
    });
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "sent", messageId: "msg_9" })
    );
    expect(mocks.refreshBroadcastCampaign).toHaveBeenCalledWith("org_1", "cmp_1");
  });

  it("al topar el límite diario reencola al día siguiente en vez de fallar", async () => {
    sentToday = 100;

    await runBroadcastWorkerOnce();

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    const requeued = updates.find((values) => values.status === "queued");
    expect(requeued).toMatchObject({ startedAt: null, errorCode: null });
    const scheduledAt = requeued?.scheduledAt as Date;
    expect(scheduledAt.getTime()).toBeGreaterThan(Date.now());
    expect(scheduledAt.getUTCHours()).toBe(0);
    expect(scheduledAt.getUTCMinutes()).toBe(1);
  });

  it("no envía si la cuenta remitente quedó apagada tras crear la campaña", async () => {
    senderRow = { enabled: false, dailyLimit: 100 };

    await runBroadcastWorkerOnce();

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "failed", errorCode: "sender_unavailable" })
    );
  });

  it("una fila sin correo falla con motivo explícito", async () => {
    dueRows = [emailRow({ email: null })];

    await runBroadcastWorkerOnce();

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "failed", errorCode: "missing_email" })
    );
  });

  it("una campaña pausada devuelve la fila a la cola sin enviar", async () => {
    campaignStatus = "paused";

    await runBroadcastWorkerOnce();

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(updates).toContainEqual(
      expect.objectContaining({ status: "queued", startedAt: null })
    );
  });
});
