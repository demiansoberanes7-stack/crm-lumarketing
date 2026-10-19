import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Apagar una cuenta de correo.
 *
 * `email_account.enabled` existía, el servicio ya lo respetaba
 * (`getEmailAccountCredentials` devuelve null con la cuenta apagada) y la
 * tarjeta lo mostraba con su badge On/Off — pero ni el PATCH lo aceptaba ni la
 * pantalla tenía dónde moverlo: el interruptor prometido no existía.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireSession: vi.fn(),
  encryptSecret: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/lib/auth/session", () => ({
  requireSession: mocks.requireSession,
  getSessionOrNull: vi.fn(),
  UnauthorizedError: class extends Error {},
  getOrphanSession: vi.fn(),
}));
vi.mock("@/lib/crypto", () => ({
  encryptSecret: mocks.encryptSecret,
  decryptSecret: vi.fn(),
}));
vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: vi.fn() }));

import { PATCH } from "@/app/api/email/accounts/[id]/route";

const escrituras: Record<string, unknown>[] = [];
let devuelveFila = true;

const db = {
  update: () => ({
    set: (values: Record<string, unknown>) => {
      escrituras.push(values);
      return {
        where: () => ({
          returning: () =>
            Promise.resolve(devuelveFila ? [{ id: "em_1" }] : []),
        }),
      };
    },
  }),
};

const credenciales = {
  email: "consulta@dentalzen.mx",
  imapHost: "imap.gmail.com",
  imapPort: 993,
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  username: "consulta@dentalzen.mx",
};

function patch(body: unknown) {
  return PATCH(
    new Request("http://local/api/email/accounts/em_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "em_1" }) }
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  escrituras.length = 0;
  devuelveFila = true;
  mocks.getDb.mockReturnValue(db);
  mocks.requireSession.mockResolvedValue({
    userId: "u_1",
    organizationId: "org_1",
    role: "owner",
  });
  mocks.encryptSecret.mockReturnValue({
    cipher: "c",
    iv: "i",
    tag: "t",
  });
});

describe("interruptor de la cuenta de email", () => {
  it("apagar sin reenviar la contraseña: solo se escribe `enabled`", async () => {
    await expect(patch({ enabled: false })).resolves.toMatchObject({ status: 200 });
    expect(escrituras[0]).toMatchObject({ enabled: false });
    expect(escrituras[0]).not.toHaveProperty("emailAddress");
    expect(escrituras[0]).not.toHaveProperty("smtpPassCipher");
  });

  it("encender otra vez", async () => {
    await expect(patch({ enabled: true })).resolves.toMatchObject({ status: 200 });
    expect(escrituras[0]).toMatchObject({ enabled: true });
  });

  it("el formulario de edición manda los datos y el estado a la vez", async () => {
    await expect(patch({ ...credenciales, enabled: false })).resolves.toMatchObject({
      status: 200,
    });
    expect(escrituras[0]).toMatchObject({
      enabled: false,
      emailAddress: credenciales.email,
      imapSecure: true,
      smtpSecure: true,
    });
  });

  it("una edición sin `enabled` no toca el interruptor", async () => {
    await expect(patch(credenciales)).resolves.toMatchObject({ status: 200 });
    expect(escrituras[0]).not.toHaveProperty("enabled");
  });

  it("un body a medias no escribe nada", async () => {
    await expect(patch({ label: "Consultas" })).resolves.toMatchObject({ status: 422 });
    expect(escrituras).toHaveLength(0);
  });

  it("una cuenta de otro negocio da 404 y no se toca", async () => {
    // El `scoped(...)` del where ya filtra por organización; la BD devuelve
    // vacío y la ruta tiene que decir que no la encontró.
    devuelveFila = false;
    await expect(patch({ enabled: false })).resolves.toMatchObject({ status: 404 });
  });

  it("solo el dueño apaga cuentas", async () => {
    mocks.requireSession.mockResolvedValue({
      userId: "u_2",
      organizationId: "org_1",
      role: "agent",
    });
    await expect(patch({ enabled: false })).resolves.toMatchObject({ status: 403 });
    expect(escrituras).toHaveLength(0);
  });
});
