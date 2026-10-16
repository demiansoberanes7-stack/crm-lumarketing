import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as startRoute } from "@/app/api/settings/google/oauth/start/route";
import { GET as callbackRoute } from "@/app/api/settings/google/oauth/callback/route";

/**
 * P2 — Google Calendar con OAuth por callback.
 *
 * Cierra el hueco que la auditoría dejó abierto: antes el refresh token se
 * pegaba a mano y la bandera `AGENDA` ni siquiera estaba encendida. Aquí se
 * prueba el contrato que importa:
 *  - apagada, la superficie ni existe (404, patrón ADR-001);
 *  - el `state` ata la vuelta de Google a la organización y se consume una vez;
 *  - sin refresh token no se guarda nada (no puede renovarse después);
 *  - el error de Google vuelve a la pantalla en vez de quedar en JSON.
 */

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getDb: vi.fn(),
  testConnection: vi.fn(),
  saveGoogleCredentials: vi.fn(),
}));

let selectQueue: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];
let deleteCalls = 0;
let fetchMock: ReturnType<typeof vi.fn>;

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "orderBy", "limit", "for", "offset"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.where = vi.fn(() => chain);
  (chain as { then: unknown }).then = (resolveFn: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolveFn);
  return chain;
}

const db = {
  select: vi.fn(() => thenableChain(selectQueue.shift() ?? [])),
  insert: vi.fn(() => ({
    values: (value: Record<string, unknown>) => {
      // Solo lo que llega a `.values()`: el objeto de tabla es circular (JSON explota).
      inserted.push(value);
      return Promise.resolve([]);
    },
    onConflictDoNothing: () => Promise.resolve([]),
  })),
  delete: vi.fn(() => ({
    where: () => {
      deleteCalls += 1;
      return Promise.resolve([]);
    },
  })),
};

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/session")>(),
  requireSession: mocks.session,
}));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/lib/env", () => ({
  // `lib/crypto` lee ENCRYPTION_KEY de este mismo getEnv: la clave de test va aquí.
  getEnv: () => ({
    APP_BASE_URL: "https://crm.test",
    GOOGLE_OAUTH_BASE_URL: "https://oauth.test",
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  }),
}));
vi.mock("@/server/agenda/connectors/google", () => ({
  GOOGLE_SCOPE: "https://www.googleapis.com/auth/calendar.events",
  googleConnector: { testConnection: mocks.testConnection },
}));
vi.mock("@/server/agenda/connectors/google-credentials", () => ({
  saveGoogleCredentials: mocks.saveGoogleCredentials,
}));

function startRequest(body: Record<string, unknown>) {
  return new Request("https://crm.test/api/settings/google/oauth/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function callbackRequest(query: Record<string, string>) {
  const url = new URL("https://crm.test/api/settings/google/oauth/callback");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new Request(url.toString());
}

/** Fila de estado pendiente lista para canjear (secret cifrado con la key de test). */
async function pendingStateRow(overrides: Record<string, unknown> = {}) {
  const { encryptSecret } = await import("@/lib/crypto");
  const secret = encryptSecret("client-secret-123");
  return {
    id: "gos_1",
    organizationId: "org_1",
    state: "state-uuid",
    clientId: "client.apps.googleusercontent.com",
    clientSecretCipher: secret.cipher,
    clientSecretIv: secret.iv,
    clientSecretTag: secret.tag,
    calendarId: "primary",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  inserted.length = 0;
  deleteCalls = 0;
  mocks.getDb.mockReturnValue(db);
  mocks.session.mockResolvedValue({
    userId: "usr_1",
    organizationId: "org_1",
    role: "owner",
  });
  mocks.testConnection.mockResolvedValue({ ok: true });
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: "at_1", refresh_token: "rt_1" }),
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AGENDA", "on");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("bandera AGENDA", () => {
  it("apagada, ni el inicio ni el callback existen (404)", async () => {
    vi.stubEnv("AGENDA", "off");

    const start = await startRoute(
      startRequest({ clientId: "c", clientSecret: "s" })
    );
    const callback = await callbackRoute(callbackRequest({ code: "a", state: "b" }));

    expect(start.status).toBe(404);
    expect(callback.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.saveGoogleCredentials).not.toHaveBeenCalled();
  });
});

describe("inicio del flujo", () => {
  it("guarda el estado pendiente y devuelve el consentimiento de Google", async () => {
    const res = await startRoute(
      startRequest({ clientId: "c.apps.googleusercontent.com", clientSecret: "s3cr3t" })
    );
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };

    expect(url.startsWith("https://oauth.test/o/oauth2/v2/auth?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("c.apps.googleusercontent.com");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://crm.test/api/settings/google/oauth/callback"
    );
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("scope")).toContain("calendar.events");

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      organizationId: "org_1",
      clientId: "c.apps.googleusercontent.com",
      calendarId: "primary",
    });
    const expires = inserted[0]!.expiresAt as Date;
    expect(expires.getTime()).toBeGreaterThan(Date.now());
    // El secreto nunca viaja en claro: solo el cifrado del estado.
    expect(JSON.stringify(inserted[0])).not.toContain("s3cr3t");
  });

  it("rechaza credenciales vacías sin tocar la base", async () => {
    const res = await startRoute(startRequest({ clientId: "", clientSecret: "" }));
    expect(res.status).toBe(422);
    expect(inserted).toHaveLength(0);
  });
});

describe("vuelta de Google (callback)", () => {
  it("state desconocido ⇒ no se canjea nada y vuelve con error legible", async () => {
    selectQueue.push([]);

    const res = await callbackRoute(callbackRequest({ code: "abc", state: "otro" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://crm.test/settings/google?error=state_invalid"
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.saveGoogleCredentials).not.toHaveBeenCalled();
  });

  it("state vencido ⇒ se consume y no autoriza", async () => {
    selectQueue.push([await pendingStateRow({ expiresAt: new Date(Date.now() - 1000) })]);

    const res = await callbackRoute(callbackRequest({ code: "abc", state: "state-uuid" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=state_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deleteCalls).toBe(1); // borrado igual: un state vencido no se reutiliza
  });

  it("éxito ⇒ canjea el código, prueba la conexión y guarda", async () => {
    selectQueue.push([await pendingStateRow()]);

    const res = await callbackRoute(callbackRequest({ code: "code-1", state: "state-uuid" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://crm.test/settings/google?connected=1"
    );

    // Intercambio code → token en el endpoint de Google.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const tokenReq = fetchMock.mock.calls[0]![0] as string;
    expect(tokenReq).toBe("https://oauth.test/token");
    const body = fetchMock.mock.calls[0]![1].body as string;
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=code-1");
    expect(body).toContain("client_secret=client-secret-123");

    expect(mocks.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "rt_1", status: "connected" })
    );
    expect(mocks.saveGoogleCredentials).toHaveBeenCalledWith({
      organizationId: "org_1",
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "client-secret-123",
      refreshToken: "rt_1",
      calendarId: "primary",
    });
    expect(deleteCalls).toBe(1);
  });

  it("el state es de un solo uso: un segundo intento ya no autoriza", async () => {
    selectQueue.push([await pendingStateRow()]);
    const first = await callbackRoute(
      callbackRequest({ code: "code-1", state: "state-uuid" })
    );
    expect(first.status).toBe(302);
    expect(mocks.saveGoogleCredentials).toHaveBeenCalledTimes(1);

    selectQueue.push([]);
    fetchMock.mockClear();
    const second = await callbackRoute(
      callbackRequest({ code: "code-1", state: "state-uuid" })
    );

    expect(second.headers.get("location")).toContain("error=state_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.saveGoogleCredentials).toHaveBeenCalledTimes(1);
  });

  it("Google devuelve la sesión pero sin refresh token ⇒ no se guarda nada", async () => {
    selectQueue.push([await pendingStateRow()]);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at_1" }),
    });

    const res = await callbackRoute(callbackRequest({ code: "code-1", state: "state-uuid" }));

    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("refresh token");
    expect(mocks.saveGoogleCredentials).not.toHaveBeenCalled();
  });

  it("si la prueba de conexión falla, no se guarda la credencial", async () => {
    selectQueue.push([await pendingStateRow()]);
    mocks.testConnection.mockResolvedValue({ ok: false, error: "403 forbidden" });

    const res = await callbackRoute(callbackRequest({ code: "code-1", state: "state-uuid" }));

    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("403 forbidden");
    expect(mocks.saveGoogleCredentials).not.toHaveBeenCalled();
  });

  it("si el dueño canceló en Google, se vuelve con ese motivo", async () => {
    const res = await callbackRoute(
      callbackRequest({ error: "access_denied", state: "state-uuid" })
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://crm.test/settings/google?error=access_denied"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("volver sin código (o sin state) no llega a canjear", async () => {
    const noCode = await callbackRoute(callbackRequest({ state: "state-uuid" }));
    expect(noCode.headers.get("location")).toContain("error=missing_code");

    selectQueue.push([]);
    const noState = await callbackRoute(callbackRequest({ code: "abc" }));
    expect(noState.headers.get("location")).toContain("error=state_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
