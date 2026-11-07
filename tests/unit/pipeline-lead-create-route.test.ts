import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  recordDiagnostic: vi.fn(),
  getDb: vi.fn(),
  eq: vi.fn(),
  scoped: vi.fn(),
  getContactById: vi.fn(),
  createLeadForContact: vi.fn(),
  updateLead: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: mocks.requireSession,
  UnauthorizedError: class extends Error {},
}));
vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: mocks.recordDiagnostic }));
vi.mock("drizzle-orm", () => ({ eq: mocks.eq }));
vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
  schema: {
    pipelineStage: { id: "stage.id", kind: "stage.kind", organizationId: "stage.organizationId" },
  },
}));
vi.mock("@/lib/db/tenant", () => ({ scoped: mocks.scoped }));
vi.mock("@/server/contacts", () => ({ getContactById: mocks.getContactById }));
vi.mock("@/server/inbox/lead-activity", () => ({ createLeadForContact: mocks.createLeadForContact }));
vi.mock("@/server/leads/service", () => ({ updateLead: mocks.updateLead }));

import { POST } from "@/app/api/pipeline/leads/route";

function request(body: unknown) {
  return POST(
    new Request("http://local/api/pipeline/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSession.mockResolvedValue({ userId: "user_1", organizationId: "org_1", role: "owner" });
  mocks.eq.mockReturnValue("stage-id-eq");
  mocks.scoped.mockReturnValue("tenant-scoped-condition");
  mocks.getContactById.mockResolvedValue({ id: "contact_1" });
  mocks.limit.mockResolvedValue([{ id: "stage_1", kind: "open" }]);
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: mocks.limit,
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  mocks.getDb.mockReturnValue({ select: vi.fn().mockReturnValue(query) });
  mocks.createLeadForContact.mockResolvedValue({ id: "lead_1", stageId: "stage_1" });
  mocks.updateLead.mockResolvedValue({ ok: true, lead: { id: "lead_1", stageId: "stage_1", amountCents: 125000 } });
});

describe("POST /api/pipeline/leads", () => {
  it("requiere un contacto de la organización antes de crear el lead", async () => {
    mocks.getContactById.mockResolvedValue(null);

    const response = await request({ contactId: "contact_ajeno", stageId: "stage_1" });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_contact" } });
    expect(mocks.createLeadForContact).not.toHaveBeenCalled();
  });

  it("rechaza etapas inexistentes o de cierre dentro del tenant", async () => {
    mocks.limit.mockResolvedValue([{ id: "stage_1", kind: "lost" }]);

    const response = await request({ contactId: "contact_1", stageId: "stage_1" });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_stage" } });
    expect(mocks.scoped).toHaveBeenCalledWith(
      "stage.organizationId",
      "org_1",
      "stage-id-eq"
    );
    expect(mocks.createLeadForContact).not.toHaveBeenCalled();
  });

  it("crea en la etapa elegida y guarda el monto opcional en centavos", async () => {
    const response = await request({ contactId: "contact_1", stageId: "stage_1", amountCents: 125000 });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      lead: { id: "lead_1", stageId: "stage_1", amountCents: 125000 },
    });
    expect(mocks.createLeadForContact).toHaveBeenCalledWith({
      organizationId: "org_1",
      contactId: "contact_1",
      stageId: "stage_1",
      source: "dueno",
      actorUserId: "user_1",
    });
    expect(mocks.updateLead).toHaveBeenCalledWith({
      organizationId: "org_1",
      actorUserId: "user_1",
      leadId: "lead_1",
      amountCents: 125000,
    });
  });

  it("no intenta guardar un monto si se omite", async () => {
    const response = await request({ contactId: "contact_1", stageId: "stage_1" });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ lead: { id: "lead_1", stageId: "stage_1" } });
    expect(mocks.updateLead).not.toHaveBeenCalled();
  });
});
