import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { GET, PUT } from "@/app/api/copilot/settings/route";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  upsert: vi.fn(),
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
  mocks.session.mockResolvedValue({ userId: "owner-a", organizationId: "org-a", role: "owner" });
  const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue([]);
  mocks.select.mockReturnValue(query);
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({ onConflictDoUpdate: mocks.upsert });
  mocks.upsert.mockResolvedValue(undefined);
});

describe("configuración del alcance del Copiloto", () => {
  it("reserva lectura y escritura a owners", async () => {
    mocks.session.mockResolvedValue({ userId: "member-a", organizationId: "org-a", role: "member" });
    const request = () => new Request("http://localhost/api/copilot/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessMode: "all" }),
    });

    expect((await GET()).status).toBe(403);
    expect((await PUT(request())).status).toBe(403);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("aplica el organization_id y devuelve defaults al owner sin configuración guardada", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      settings: { accessMode: "selected", dataSources: ["metrics", "pipeline", "contacts", "agenda"] },
    });

    const query = new PgDialect().sqlToQuery(mocks.select.mock.results[0]!.value.where.mock.calls[0]![0]);
    expect(query.sql).toContain('"copilot_settings"."organization_id" = $1');
    expect(query.params).toEqual(["org-a"]);
  });

  it("guarda por organización y rechaza una selección vacía", async () => {
    const request = (body: unknown) => new Request("http://localhost/api/copilot/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const invalid = await PUT(request({ accessMode: "selected", dataSources: [] }));
    expect(invalid.status).toBe(422);
    expect(mocks.insert).not.toHaveBeenCalled();

    const response = await PUT(request({ accessMode: "selected", dataSources: ["quotes"] }));
    expect(response.status).toBe(200);
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-a",
      accessMode: "selected",
      dataSources: ["quotes"],
      updatedBy: "owner-a",
    }));
  });
});
