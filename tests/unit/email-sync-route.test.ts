import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sincronizar el buzón.
 *
 * Con la cuenta apagada, `syncInbox` lanza el mismo mensaje que un error real
 * de IMAP, y la ruta lo registraba en Diagnóstico: abrir el buzón de una cuenta
 * con el interruptor en Off llenaba la pantalla de «No se pudo sincronizar la
 * cuenta de correo» cada pocos minutos. Un interruptor apagado es una decisión
 * del dueño, no una falla del servidor: se responde 409 con el motivo y sin
 * evento.
 */

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  recordDiagnostic: vi.fn(),
  syncInbox: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: mocks.requireSession,
  getSessionOrNull: vi.fn(),
  UnauthorizedError: class extends Error {},
  getOrphanSession: vi.fn(),
}));
vi.mock("@/server/diagnostics/logger", () => ({
  recordDiagnostic: mocks.recordDiagnostic,
}));
vi.mock("@/server/email/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/email/service")>();
  return { ...actual, syncInbox: mocks.syncInbox };
});

import { POST } from "@/app/api/email/accounts/[id]/sync/route";
import { CUENTA_MUDA, EmailAccountUnavailableError } from "@/server/email/service";

function sync() {
  return POST(
    new Request("http://local/api/email/accounts/em_1/sync", { method: "POST" }),
    { params: Promise.resolve({ id: "em_1" }) }
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSession.mockResolvedValue({
    userId: "u_1",
    organizationId: "org_1",
    role: "owner",
  });
});

describe("POST /api/email/accounts/[id]/sync", () => {
  it("cuenta apagada: 409 con el motivo y sin evento de error", async () => {
    mocks.syncInbox.mockRejectedValue(new EmailAccountUnavailableError(CUENTA_MUDA));

    const res = await sync();

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "account_unavailable", message: CUENTA_MUDA },
    });
    expect(mocks.recordDiagnostic).not.toHaveBeenCalled();
  });

  it("falla real de IMAP: 502 y queda el diagnóstico técnico", async () => {
    mocks.syncInbox.mockRejectedValue(new Error("getaddrinfo ENOTFOUND imap.hostinger.com"));

    const res = await sync();

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("sync_failed");
    expect(body.error.message).toContain("No se pudo sincronizar el correo");
    expect(mocks.recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        source: "email",
        code: "email_sync_failed",
      })
    );
  });

  it("sincroniza dentro del negocio de la sesión", async () => {
    mocks.syncInbox.mockResolvedValue(3);

    const res = await sync();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, synced: 3 });
    expect(mocks.syncInbox).toHaveBeenCalledWith("org_1", "em_1");
    expect(mocks.recordDiagnostic).not.toHaveBeenCalled();
  });
});
