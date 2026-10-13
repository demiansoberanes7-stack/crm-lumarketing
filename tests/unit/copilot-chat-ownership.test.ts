import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { POST } from "@/app/api/watsi/chat/route";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  diagnostic: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/session")>(),
  requireSession: mocks.session,
}));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: () => ({ select: mocks.select, insert: mocks.insert }),
}));
vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: mocks.diagnostic }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: "user-b", organizationId: "org-b", role: "member" });
  const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue([]);
  mocks.select.mockReturnValue(query);
});

describe("propiedad de conversaciones del Copiloto", () => {
  it("rechaza una conversación ajena antes de insertar o consultar el modelo", async () => {
    const response = await POST(new Request("http://localhost/api/watsi/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "¿Cómo van las ventas?", conversationId: "watsi_other" }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
    expect(mocks.insert).not.toHaveBeenCalled();
    const where = mocks.select.mock.results[0]!.value.where.mock.calls[0]![0];
    const query = new PgDialect().sqlToQuery(where);
    expect(query.sql).toContain('"watsi_conversation"."organization_id" = $1');
    expect(query.sql).toContain('"watsi_conversation"."user_id" = $3');
    expect(query.params).toEqual(["org-b", "watsi_other", "user-b"]);
  });
});
