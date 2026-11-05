import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DELETE,
  GET,
  PATCH,
} from "@/app/api/settings/google/personal/route";
import { POST as startRoute } from "@/app/api/settings/google/personal/oauth/start/route";

/**
 * 015 · B2 — Las rutas del calendario PERSONAL.
 *
 * Lo que se jura aquí es una sola cosa: ESTAS rutas solo escriben la fila de
 * quien está en la sesión. El `userId` nunca sale del body, así que un miembro no
 * puede apagar la sincronización de un compañero, desconectar el negocio, ni
 * atribuirse el consentimiento de otro. Y la tarjeta no miente: lee la fila
 * EXACTA (`peek`, sin la cascada de escritura), porque decir «conectado» cuando
 * lo está el del negocio es justo el aviso que alguien esperaría para sus tareas.
 */

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  agendaEnabled: vi.fn(),
  peekGoogleCredentials: vi.fn(),
  getBusinessGoogleCredentials: vi.fn(),
  setGoogleTasksSync: vi.fn(),
  deleteGoogleCredentials: vi.fn(),
  startGoogleOAuth: vi.fn(),
  syncPendingTasks: vi.fn(),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireSession: mocks.session,
}));
vi.mock("@/server/agenda/flag", async (importOriginal) => ({
  // `agendaDisabledResponse` se deja REAL: lo que se prueba es que sin la
  // bandera la superficie responde como el resto del sistema (404), no otra cosa.
  ...(await importOriginal<typeof import("@/server/agenda/flag")>()),
  agendaEnabled: mocks.agendaEnabled,
}));
vi.mock("@/server/agenda/connectors/google-credentials", () => ({
  peekGoogleCredentials: mocks.peekGoogleCredentials,
  getBusinessGoogleCredentials: mocks.getBusinessGoogleCredentials,
  setGoogleTasksSync: mocks.setGoogleTasksSync,
  deleteGoogleCredentials: mocks.deleteGoogleCredentials,
}));
vi.mock("@/server/agenda/google-oauth", () => ({
  startGoogleOAuth: mocks.startGoogleOAuth,
}));
vi.mock("@/server/agenda/tasks-sync", () => ({
  syncPendingTasks: mocks.syncPendingTasks,
}));

const MEMBER = { userId: "usr_a", organizationId: "org_1", role: "member" };
const personal = {
  status: "connected",
  calendarId: "ana@correo.test",
  syncTasks: true,
  userId: "usr_a",
};

function patchRequest(body: Record<string, unknown>) {
  return new Request("https://crm.test/api/settings/google/personal", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function startRequest(body: Record<string, unknown> = {}) {
  return new Request("https://crm.test/api/settings/google/personal/oauth/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(MEMBER as never);
  mocks.agendaEnabled.mockReturnValue(true);
  mocks.peekGoogleCredentials.mockResolvedValue(null as never);
  mocks.getBusinessGoogleCredentials.mockResolvedValue(null as never);
  mocks.setGoogleTasksSync.mockResolvedValue(undefined);
  mocks.deleteGoogleCredentials.mockResolvedValue(undefined);
  mocks.startGoogleOAuth.mockResolvedValue("https://oauth.test/auth?state=xyz");
  mocks.syncPendingTasks.mockResolvedValue({ synced: 0, failed: 0 });
});

describe("leer la propia conexión", () => {
  it("enseña la fila personal exacta, aunque la del negocio sí esté conectada", async () => {
    mocks.getBusinessGoogleCredentials.mockResolvedValue({
      status: "connected",
      calendarId: "primary",
    } as never);

    const res = await GET();
    expect(await res.json()).toEqual({
      connection: null,
      syncTasks: false,
      businessConnected: true,
    });
    // `peek` y no la cascada: la tarjeta no puede decir «conectado» por merced
    // del calendario de la empresa.
    expect(mocks.peekGoogleCredentials).toHaveBeenCalledWith("org_1", "usr_a");
  });

  it("con fila propia, sale estado y calendario — y ni un rastro del secreto de la app", async () => {
    mocks.peekGoogleCredentials.mockResolvedValue(personal as never);

    const body = await (await GET()).json();
    expect(body).toEqual({
      connection: { status: "connected", calendarId: "ana@correo.test" },
      syncTasks: true,
      businessConnected: false,
    });
    expect(JSON.stringify(body)).not.toContain("clientSecret");
    expect(JSON.stringify(body)).not.toContain("secretLast4");
  });

  it("sin la bandera de agenda, la superficie ni existe", async () => {
    mocks.agendaEnabled.mockReturnValue(false);
    expect((await GET()).status).toBe(404);
    expect(mocks.peekGoogleCredentials).not.toHaveBeenCalled();
  });
});

describe("interruptor de tareas", () => {
  it("escribe SOLO la fila de quien está en la sesión y rellena SOLO sus tareas", async () => {
    mocks.peekGoogleCredentials.mockResolvedValue(personal as never);
    mocks.syncPendingTasks.mockResolvedValue({ synced: 4, failed: 0 });

    const res = await PATCH(patchRequest({ syncTasks: true }));
    expect(await res.json()).toEqual({
      syncTasks: true,
      backfilled: { synced: 4, failed: 0 },
    });
    expect(mocks.setGoogleTasksSync).toHaveBeenCalledWith("org_1", true, "usr_a");
    // El tercer argumento es el dueño: sin él, el relleno subiría las tareas de
    // sus compañeros a SU calendario.
    expect(mocks.syncPendingTasks).toHaveBeenCalledWith("org_1", 100, "usr_a");
  });

  it("apagar no rellena nada", async () => {
    mocks.peekGoogleCredentials.mockResolvedValue(personal as never);

    await PATCH(patchRequest({ syncTasks: false }));
    expect(mocks.setGoogleTasksSync).toHaveBeenCalledWith("org_1", false, "usr_a");
    expect(mocks.syncPendingTasks).not.toHaveBeenCalled();
  });

  it("un `userId` metido en el body no mueve la fila de otro", async () => {
    mocks.peekGoogleCredentials.mockResolvedValue(personal as never);

    await PATCH(
      patchRequest({
        syncTasks: true,
        userId: "usr_b",
        organizationId: "org_2",
      })
    );
    expect(mocks.peekGoogleCredentials).toHaveBeenCalledWith("org_1", "usr_a");
    expect(mocks.setGoogleTasksSync).toHaveBeenCalledWith("org_1", true, "usr_a");
    expect(mocks.syncPendingTasks).toHaveBeenCalledWith("org_1", 100, "usr_a");
  });

  it("sin calendario personal conectado no hay nada que encender", async () => {
    const res = await PATCH(patchRequest({ syncTasks: true }));
    expect(res.status).toBe(409);
    expect(mocks.setGoogleTasksSync).not.toHaveBeenCalled();
    expect(mocks.syncPendingTasks).not.toHaveBeenCalled();
  });

  it("un valor que no es booleano se rechaza antes de escribir", async () => {
    const res = await PATCH(patchRequest({ syncTasks: "si" }));
    expect(res.status).toBe(422);
    expect(mocks.setGoogleTasksSync).not.toHaveBeenCalled();
  });
});

describe("desconectar", () => {
  it("borra la fila propia, no la del negocio", async () => {
    await DELETE();
    expect(mocks.deleteGoogleCredentials).toHaveBeenCalledWith("org_1", "usr_a");
  });
});

describe("pedir el consentimiento a Google", () => {
  it("sin Google del negocio conectado, un miembro no tiene a quién pedirle el permiso", async () => {
    const res = await startRoute(startRequest());
    expect(res.status).toBe(409);
    expect(mocks.startGoogleOAuth).not.toHaveBeenCalled();
  });

  it("el estado se inicia a nombre de la sesión, con las credenciales del negocio", async () => {
    mocks.getBusinessGoogleCredentials.mockResolvedValue({
      status: "connected",
      clientId: "app.apps.googleusercontent.com",
      clientSecret: "secreto-del-negocio",
      calendarId: "primary",
    } as never);

    const res = await startRoute(startRequest({ calendarId: "ana@correo.test" }));
    expect(await res.json()).toEqual({ url: "https://oauth.test/auth?state=xyz" });
    expect(mocks.startGoogleOAuth).toHaveBeenCalledWith({
      organizationId: "org_1",
      clientId: "app.apps.googleusercontent.com",
      clientSecret: "secreto-del-negocio",
      calendarId: "ana@correo.test",
      userId: "usr_a",
    });
  });

  it("el body no puede elegir negocio ni usuario", async () => {
    mocks.getBusinessGoogleCredentials.mockResolvedValue({
      status: "connected",
      clientId: "app.apps.googleusercontent.com",
      clientSecret: "secreto-del-negocio",
      calendarId: "primary",
    } as never);

    await startRoute(startRequest({ userId: "usr_b", organizationId: "org_9" }));
    expect(mocks.startGoogleOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", userId: "usr_a" })
    );
  });

  it("sin calendarId propio, se pide el primario", async () => {
    mocks.getBusinessGoogleCredentials.mockResolvedValue({
      status: "connected",
      clientId: "app",
      clientSecret: "sec",
      calendarId: "primary",
    } as never);

    await startRoute(startRequest());
    expect(mocks.startGoogleOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "primary" })
    );
  });
});
