import { afterEach, describe, expect, it, vi } from "vitest";
import { graphRequest, MetaApiError, normalizeMx, normalizeRecipient } from "@/lib/meta/client";

vi.mock("@/lib/env", () => ({ getEnv: () => ({ META_GRAPH_BASE_URL: "http://meta.test", META_GRAPH_API_VERSION: "v23.0" }) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("graphRequest deadline", () => {
  it.each(["headers", "body"])("aborts stalled %s with a recoverable error and no duplicate send", async (phase) => {
    const controller = new AbortController();
    const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const stalled = () => new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    });
    const fetchMock = vi.fn(async () => phase === "headers" ? stalled() : { text: stalled });
    vi.stubGlobal("fetch", fetchMock);
    const request = graphRequest("messages", { method: "POST", token: "local-test-token", body: { text: "hola" } });
    const result = expect(request).rejects.toMatchObject({ name: "MetaApiError", status: 0, isAuthError: false, message: "La API de Meta tardó demasiado en responder" });
    await Promise.resolve(); // Allow the body reader to attach its abort listener.
    controller.abort(new DOMException("deadline", "TimeoutError"));
    await result;
    expect(deadline).toHaveBeenCalledWith(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal, method: "POST" }));
  });

  it("keeps successful JSON and provider HTTP errors intact", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ id: "msg" }))
      .mockResolvedValueOnce(Response.json({ error: { message: "Expired", code: 190 } }, { status: 401 })));
    await expect(graphRequest("messages", { token: "test" })).resolves.toEqual({ id: "msg" });
    await expect(graphRequest("messages", { token: "test" })).rejects.toMatchObject({ status: 401, code: 190, isAuthError: true });
  });
});

describe("normalizeRecipient", () => {
  it("México móvil legado: 521 + 10 dígitos → 52 + 10 dígitos", () => {
    expect(normalizeRecipient("5215512345678")).toBe("525512345678");
  });

  it("México ya normalizado queda intacto", () => {
    expect(normalizeRecipient("525512345678")).toBe("525512345678");
  });

  it("Argentina móvil: 549 + 10 dígitos → 54 + 10 dígitos (issue #35)", () => {
    // Meta reporta `549…` pero la lista de destinatarios de prueba solo
    // acepta el número sin el 9: con el 9 responde 131030 y el panel muestra
    // el número como habilitado, así que el error manda a revisar donde no es.
    expect(normalizeRecipient("5491122334455")).toBe("541122334455");
  });

  it("Argentina ya normalizada queda intacta", () => {
    expect(normalizeRecipient("541122334455")).toBe("541122334455");
  });

  it("otros países quedan intactos", () => {
    expect(normalizeRecipient("14155552671")).toBe("14155552671");
    expect(normalizeRecipient("50761234567")).toBe("50761234567");
  });

  it("no confunde números que empiezan en el troncal pero con otra longitud", () => {
    expect(normalizeRecipient("521123")).toBe("521123");
    expect(normalizeRecipient("549123")).toBe("549123");
    // 549 + 11 dígitos no es un móvil argentino: no se toca.
    expect(normalizeRecipient("54911223344556")).toBe("54911223344556");
  });

  it("la identidad NO se toca: normalizar al enviar es asimétrico a propósito", () => {
    // Si la ingesta reescribiera `549…`, la identidad guardada dejaría de
    // coincidir con el `wa_id` de cada webhook y el contacto se partiría.
    expect(normalizeMx("5491122334455")).toBe("5491122334455");
  });
});

describe("MetaApiError.isAuthError", () => {
  it("status 401 es error de auth", () => {
    expect(new MetaApiError("x", { status: 401 }).isAuthError).toBe(true);
  });

  it("code 190 es error de auth (token vencido)", () => {
    expect(new MetaApiError("x", { status: 400, code: 190 }).isAuthError).toBe(
      true
    );
  });

  it("OAuthException solo NO basta (Meta la usa en errores transitorios)", () => {
    // Incidente 2026-08-03: un 500 con type OAuthException (código 2,
    // "service temporarily unavailable") marcaba el token como vencido y
    // bloqueaba TODO envío. El type por sí solo jamás decide.
    expect(
      new MetaApiError("x", { status: 400, type: "OAuthException" }).isAuthError
    ).toBe(false);
    expect(
      new MetaApiError("x", { status: 500, code: 2, type: "OAuthException" })
        .isAuthError
    ).toBe(false);
  });

  it("OAuthException con código 190 sí es error de auth", () => {
    expect(
      new MetaApiError("x", { status: 400, code: 190, type: "OAuthException" })
        .isAuthError
    ).toBe(true);
  });

  it("un 5xx JAMÁS es error de auth, ni con código 190", () => {
    expect(new MetaApiError("x", { status: 500 }).isAuthError).toBe(false);
    expect(
      new MetaApiError("x", { status: 500, code: 190 }).isAuthError
    ).toBe(false);
  });
});
