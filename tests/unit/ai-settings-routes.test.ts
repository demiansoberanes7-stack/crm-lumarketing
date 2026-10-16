import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteAi, GET as getAi, PUT as putAi } from "@/app/api/settings/ai/route";
import { POST as postAiTest } from "@/app/api/settings/ai/test/route";

/**
 * Rutas owner-only de la clave LLM compartida (agente + copiloto):
 * guardar/conservar/quitar la clave y probar la conexión — con la semántica
 * "····" = conservar la guardada, igual que las credenciales INTEL.
 */

const h = vi.hoisted(() => ({
  session: { userId: "usr_1", organizationId: "org_1", role: "owner" as string },
  getAiDbToken: vi.fn(),
  getAiCredentialSummary: vi.fn(),
  saveAiToken: vi.fn(),
  clearAiToken: vi.fn(),
  verifyAiToken: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class extends Error {},
  requireSession: async () => h.session,
  getSessionOrNull: async () => h.session,
}));

vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: vi.fn(async () => {}) }));

vi.mock("@/server/ai/credentials", () => ({
  getAiDbToken: h.getAiDbToken,
  getAiCredentialSummary: h.getAiCredentialSummary,
  saveAiToken: h.saveAiToken,
  clearAiToken: h.clearAiToken,
  verifyAiToken: h.verifyAiToken,
}));

const DB_SUMMARY = { configured: true, source: "db", last4: "1234" } as const;
const NONE_SUMMARY = { configured: false, source: "none", last4: null } as const;

function put(body: unknown): Request {
  return new Request("http://localhost/api/settings/ai", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/settings/ai/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.session = { userId: "usr_1", organizationId: "org_1", role: "owner" };
  h.getAiDbToken.mockResolvedValue(null);
  h.getAiCredentialSummary.mockResolvedValue(NONE_SUMMARY);
  h.saveAiToken.mockResolvedValue(true);
  h.clearAiToken.mockResolvedValue(true);
  h.verifyAiToken.mockResolvedValue({ ok: true });
  delete process.env.OPENROUTER_API_TOKEN;
});

describe("solo el propietario", () => {
  it("bloquea GET, PUT, DELETE y test con 403 sin tocar credenciales", async () => {
    h.session = { userId: "member_1", organizationId: "org_1", role: "member" };
    const responses = await Promise.all([
      getAi(),
      putAi(put({ token: "sk-nueva-clave-123" })),
      deleteAi(),
      postAiTest(post({ token: "sk-nueva-clave-123" })),
    ]);
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(h.saveAiToken).not.toHaveBeenCalled();
    expect(h.clearAiToken).not.toHaveBeenCalled();
    expect(h.verifyAiToken).not.toHaveBeenCalled();
    expect(h.getAiCredentialSummary).not.toHaveBeenCalled();
  });
});

describe("GET /api/settings/ai", () => {
  it("devuelve el resumen sin exponer la clave", async () => {
    h.getAiCredentialSummary.mockResolvedValue(DB_SUMMARY);
    const response = await getAi();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ai: DB_SUMMARY });
    expect(JSON.stringify(body)).not.toContain("sk-");
  });
});

describe("PUT /api/settings/ai", () => {
  it("guarda una clave nueva (cifrada, prioridad sobre el env)", async () => {
    h.getAiCredentialSummary.mockResolvedValue(DB_SUMMARY);
    const response = await putAi(put({ token: "sk-nueva-clave-123" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true, ai: DB_SUMMARY });
    expect(h.saveAiToken).toHaveBeenCalledWith("org_1", "sk-nueva-clave-123");
  });

  it("token enmascarado (····) CONSERVA la guardada", async () => {
    const response = await putAi(put({ token: "····1234" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: false });
    expect(h.saveAiToken).not.toHaveBeenCalled();
  });

  it("token vacío CONSERVA la guardada", async () => {
    const response = await putAi(put({ token: "" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: false });
    expect(h.saveAiToken).not.toHaveBeenCalled();
  });

  it("rechaza claves demasiado cortas", async () => {
    const response = await putAi(put({ token: "abc" }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("token_too_short");
    expect(h.saveAiToken).not.toHaveBeenCalled();
  });

  it("404 si la organización no tiene perfil del agente", async () => {
    h.saveAiToken.mockResolvedValue(false);
    const response = await putAi(put({ token: "sk-nueva-clave-123" }));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  });
});

describe("DELETE /api/settings/ai", () => {
  it("quita la clave guardada y devuelve el nuevo resumen", async () => {
    const response = await deleteAi();
    expect(response.status).toBe(200);
    expect(h.clearAiToken).toHaveBeenCalledWith("org_1");
    expect(await response.json()).toEqual({ ai: NONE_SUMMARY });
  });
});

describe("POST /api/settings/ai/test", () => {
  it("enmascarada con clave guardada: prueba la de BD", async () => {
    h.getAiDbToken.mockResolvedValue("sk-guardada-9999");
    const response = await postAiTest(post({ token: "····9999" }));
    expect(response.status).toBe(200);
    expect(h.verifyAiToken).toHaveBeenCalledWith("sk-guardada-9999");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("enmascarada sin clave guardada y sin env → 422 ai_not_saved", async () => {
    h.getAiDbToken.mockResolvedValue(null);
    const response = await postAiTest(post({ token: "····9999" }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("ai_not_saved");
    expect(h.verifyAiToken).not.toHaveBeenCalled();
  });

  it("enmascarada sin BD usa la variable de entorno como respaldo", async () => {
    process.env.OPENROUTER_API_TOKEN = "sk-env-key-1111";
    h.getAiDbToken.mockResolvedValue(null);
    const response = await postAiTest(post({ token: "····1111" }));
    expect(response.status).toBe(200);
    expect(h.verifyAiToken).toHaveBeenCalledWith("sk-env-key-1111");
  });

  it("clave nueva: la prueba directamente", async () => {
    const response = await postAiTest(post({ token: "sk-nueva-clave-123" }));
    expect(response.status).toBe(200);
    expect(h.verifyAiToken).toHaveBeenCalledWith("sk-nueva-clave-123");
    expect(h.getAiDbToken).not.toHaveBeenCalled();
  });

  it("proveedor rechaza la clave → 422 con el motivo", async () => {
    h.verifyAiToken.mockResolvedValue({ ok: false, reason: "El proveedor rechazó la clave (HTTP 401)." });
    const response = await postAiTest(post({ token: "sk-mala-123" }));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: "ai_test_failed",
      message: expect.stringContaining("401"),
    });
  });

  it("token vacío → 422 de body inválido", async () => {
    const response = await postAiTest(post({ token: "" }));
    expect(response.status).toBe(422);
    expect(h.verifyAiToken).not.toHaveBeenCalled();
  });
});
