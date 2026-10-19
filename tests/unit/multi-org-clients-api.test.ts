import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Las dos rutas de alta de negocios:
 *   POST /api/auth/organization  → el cliente nombra SU negocio tras registrarse
 *   POST /api/settings/clients   → el operador de la instancia da de alta un cliente
 *
 * La primera no puede pasar por `withAuth` (exige membresía y el usuario recién
 * registrado no la tiene), así que su autorización se prueba aquí.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getAuth: vi.fn(),
  getSession: vi.fn(),
  signUpEmail: vi.fn(),
  requireSession: vi.fn(),
  provision: vi.fn(),
  isInstanceOwner: vi.fn(),
  recordDiagnostic: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

vi.mock("@/lib/auth", () => ({
  getAuth: mocks.getAuth,
  runInternalSignup: (fn: () => Promise<unknown>) => fn(),
}));

// importOriginal para que `UnauthorizedError` siga siendo LA MISMA clase que
// compara `withAuth`: si se reemplaza, un 401 se convertiría en 500.
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/session")>(),
  requireSession: mocks.requireSession,
}));

// importOriginal también aquí: `session.ts` importa `resolveMembership` de este
// módulo y, si el mock no lo exporta, el enlace ESM falla al evaluarlo.
vi.mock("@/server/auth/on-signup", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/auth/on-signup")>(),
  provisionOrganization: mocks.provision,
  isInstanceOwner: mocks.isInstanceOwner,
}));

vi.mock("@/server/diagnostics/logger", () => ({
  recordDiagnostic: mocks.recordDiagnostic,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { UnauthorizedError } from "@/lib/auth/session";
import { POST as bootstrapOrganization } from "@/app/api/auth/organization/route";
import { GET as listClients, POST as createClient } from "@/app/api/settings/clients/route";

const OWNER_SESSION = { userId: "u_ana", organizationId: "org_1", role: "owner" };

function jsonRequest(path: string, body: unknown) {
  return new Request(`http://local${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDb.mockReturnValue({
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          groupBy: () => ({
            orderBy: () => Promise.resolve([]),
          }),
        }),
      }),
    }),
  });
  mocks.getAuth.mockReturnValue({
    api: { getSession: mocks.getSession, signUpEmail: mocks.signUpEmail },
  });
  mocks.requireSession.mockResolvedValue(OWNER_SESSION);
  mocks.isInstanceOwner.mockResolvedValue(true);
  mocks.provision.mockResolvedValue({ ok: true, organizationId: "org_nueva", created: true });
});

describe("POST /api/auth/organization", () => {
  it("sin sesión → 401", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await bootstrapOrganization(
      jsonRequest("/api/auth/organization", { name: "Aurora" })
    );
    expect(res.status).toBe(401);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("body inválido → 422 sin intentar aprovisionar", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u_1", name: "Ana" } });
    const res = await bootstrapOrganization(jsonRequest("/api/auth/organization", {}));
    expect(res.status).toBe(422);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("negocio nuevo → 201 con su id", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u_1", name: "Ana" } });
    const res = await bootstrapOrganization(
      jsonRequest("/api/auth/organization", { name: "Peluquería Aurora" })
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      organizationId: "org_nueva",
      created: true,
    });
    expect(mocks.provision).toHaveBeenCalledWith("u_1", "Peluquería Aurora");
  });

  it("si ya tenía negocio, 200 y no se duplica", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u_1", name: "Ana" } });
    mocks.provision.mockResolvedValue({
      ok: true,
      organizationId: "org_vieja",
      created: false,
    });
    const res = await bootstrapOrganization(
      jsonRequest("/api/auth/organization", { name: "Otro nombre" })
    );
    expect(res.status).toBe(200);
  });

  it("rechazo del paso de BD → 500 en JSON, no una página de error", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u_1", name: "Ana" } });
    mocks.provision.mockRejectedValue(new Error("boom"));
    const res = await bootstrapOrganization(
      jsonRequest("/api/auth/organization", { name: "Aurora" })
    );
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "internal" } });
  });
});

describe("POST /api/settings/clients", () => {
  const BODY = {
    businessName: "Peluquería Aurora",
    name: "Ana",
    email: "ana@aurora.mx",
    password: "secreta123",
  };

  it("sin sesión → 401", async () => {
    mocks.requireSession.mockRejectedValue(new UnauthorizedError());
    const res = await createClient(jsonRequest("/api/settings/clients", BODY));
    expect(res.status).toBe(401);
  });

  it("un miembro común no puede crear negocios", async () => {
    mocks.requireSession.mockResolvedValue({ ...OWNER_SESSION, role: "member" });
    const res = await createClient(jsonRequest("/api/settings/clients", BODY));
    expect(res.status).toBe(403);
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("un owner de negocio que no opera la instancia tampoco", async () => {
    mocks.isInstanceOwner.mockResolvedValue(false);
    const res = await createClient(jsonRequest("/api/settings/clients", BODY));
    expect(res.status).toBe(403);
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("el operador crea la cuenta del cliente y su negocio aislado", async () => {
    mocks.signUpEmail.mockResolvedValue({ user: { id: "u_cliente" } });
    const res = await createClient(jsonRequest("/api/settings/clients", BODY));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      organizationId: "org_nueva",
      email: "ana@aurora.mx",
    });
    expect(mocks.provision).toHaveBeenCalledWith("u_cliente", "Peluquería Aurora");
  });

  it("correo repetido → 409 antes de tocar organizaciones", async () => {
    mocks.signUpEmail.mockRejectedValue(new Error("User already exists"));
    const res = await createClient(jsonRequest("/api/settings/clients", BODY));
    expect(res.status).toBe(409);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("contraseña corta → 422 y no se crea la cuenta", async () => {
    const res = await createClient(
      jsonRequest("/api/settings/clients", { ...BODY, password: "corta" })
    );
    expect(res.status).toBe(422);
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("un campo de más en el body se rechaza", async () => {
    const res = await createClient(
      jsonRequest("/api/settings/clients", { ...BODY, role: "owner" })
    );
    expect(res.status).toBe(422);
  });
});

describe("GET /api/settings/clients", () => {
  it("es solo del operador de la instancia", async () => {
    mocks.isInstanceOwner.mockResolvedValue(false);
    const res = await listClients();
    expect(res.status).toBe(403);
  });

  it("devuelve los negocios con su número de cuentas", async () => {
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            groupBy: () => ({
              orderBy: () =>
                Promise.resolve([
                  {
                    id: "org_1",
                    name: "Lumarketing",
                    slug: "principal",
                    createdAt: new Date("2026-01-01T00:00:00Z"),
                    members: 3,
                  },
                ]),
            }),
          }),
        }),
      }),
    });
    const res = await listClients();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      organizations: [
        { id: "org_1", name: "Lumarketing", members: 3, slug: "principal" },
      ],
    });
  });
});
