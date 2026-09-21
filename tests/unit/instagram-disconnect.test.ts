import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { DELETE } from "@/app/api/settings/instagram/route";
import { schema } from "@/lib/db";
import { UnauthorizedError } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  enabled: vi.fn(),
  remove: vi.fn(),
  where: vi.fn(),
  diagnostic: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: mocks.session,
  UnauthorizedError: class extends Error {},
}));
vi.mock("@/server/channels/enabled", () => ({
  isChannelEnabled: mocks.enabled,
  channelDisabledResponse: () => new Response(null, { status: 404 }),
}));
vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: mocks.diagnostic }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: () => ({ delete: mocks.remove }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ userId: "user-a", organizationId: "org-a", role: "owner" });
  mocks.enabled.mockReturnValue(true);
  mocks.remove.mockReturnValue({ where: mocks.where });
  mocks.where.mockResolvedValue(undefined);
});

describe("desvincular Instagram del CRM", () => {
  it("solo elimina credenciales de la organización autenticada y registra el diagnóstico", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith(schema.instagramCredentials);
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]);
    expect(query.sql).toContain('"instagram_credentials"."organization_id" = $1');
    expect(query.params).toEqual(["org-a"]);
    expect(mocks.diagnostic).toHaveBeenCalledWith({
      organizationId: "org-a", source: "instagram", code: "disconnected", severity: "info",
    });
  });

  it("puede repetirse aunque la conexión ya no exista", async () => {
    expect((await DELETE()).status).toBe(200);
    expect((await DELETE()).status).toBe(200);
  });

  it("sin sesión responde 401 sin borrar", async () => {
    mocks.session.mockRejectedValue(new UnauthorizedError());
    expect((await DELETE()).status).toBe(401);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("con el canal apagado responde 404 sin borrar", async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await DELETE()).status).toBe(404);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("un fallo de base de datos no se informa como desconexión exitosa", async () => {
    mocks.where.mockRejectedValue(new Error("database unavailable"));
    const res = await DELETE();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "internal" } });
    expect(mocks.diagnostic).not.toHaveBeenCalledWith(expect.objectContaining({ code: "disconnected" }));
  });
});
