import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGoogleTokenCache } from "@/server/agenda/connectors/google-credentials";

/**
 * Google Calendar como destinatorio de Pendientes y tareas de proyecto.
 *
 * Lo que se protege aquí es la semántica de "un evento por tarea" y, sobre
 * todo, que TODO queda apagado por defecto: sin bandera, sin credenciales o
 * con el interruptor en off, no se contacta a Google ni por casualidad.
 */

type Call = { method: string; url: string; body?: string };

const state = {
  agenda: true,
  creds: null as null | Record<string, unknown>,
  calls: [] as Call[],
  saves: [] as Record<string, unknown>[],
  selectRow: null as Record<string, unknown> | null,
  /** Filas por tabla para las consultas de relleno. */
  rowsByTable: {} as Record<string, Record<string, unknown>[]>,
  diagnostics: [] as { code?: string; metadata?: Record<string, unknown> }[],
  /** Organizaciones cuya credencial se marcó como rota. */
  marked: [] as string[],
  /** Qué responde cada petición: status por defecto 200 con este JSON. */
  respond: (_call: Call): { status: number; json?: unknown } => ({ status: 200, json: {} }),
};

function reset() {
  state.agenda = true;
  state.creds = null;
  state.calls = [];
  state.saves = [];
  state.selectRow = null;
  state.rowsByTable = {};
  state.diagnostics = [];
  state.marked = [];
  state.respond = () => ({ status: 200, json: {} });
  // El access token se cachea por proceso: sin limpiarlo, un test hereda el
  // "tok" de otro y el rechazo del refresh token nunca llega a ejercitarse.
  clearGoogleTokenCache();
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.saves.push(values);
        return { where: async () => [] };
      },
    }),
    select: () => {
      const chain: Record<string, unknown> = {};
      let table = "";
      chain.from = (source: { __table?: string }) => {
        table = source.__table ?? "";
        return chain;
      };
      chain.leftJoin = () => chain;
      chain.where = () => chain;
      chain.limit = async () => {
        const rows = state.rowsByTable[table];
        if (rows) return rows;
        return state.selectRow ? [state.selectRow] : [];
      };
      return chain;
    },
  }),
  schema: {
    caltodoTask: { id: "id", organizationId: "organization_id", __table: "caltodoTask" },
    projectTask: { id: "id", organizationId: "organization_id", __table: "projectTask" },
    project: { id: "id", name: "name", __table: "project" },
  },
}));

vi.mock("@/server/agenda/connectors/google-credentials", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/agenda/connectors/google-credentials")>();
  return {
    ...actual,
    getGoogleCredentials: async () => state.creds,
    markGoogleError: async (organizationId: string) => {
      state.marked.push(organizationId);
    },
  };
});

vi.mock("@/server/agenda/flag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/agenda/flag")>();
  return { ...actual, agendaEnabled: () => state.agenda };
});

vi.mock("@/server/diagnostics/logger", () => ({
  recordDiagnostic: async (input: { code?: string; metadata?: Record<string, unknown> }) => {
    state.diagnostics.push(input);
  },
}));

async function load() {
  const { pushTaskEvent, syncTaskById, syncPendingTasks, taskEventIdFor, removeTaskEvent } =
    await import("@/server/agenda/tasks-sync");
  return { pushTaskEvent, syncTaskById, syncPendingTasks, taskEventIdFor, removeTaskEvent };
}

function connected(syncTasks = true) {
  return {
    clientId: "cid",
    clientSecret: "secret",
    refreshToken: "refresh",
    calendarId: "primary",
    status: "connected",
    syncTasks,
  };
}

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  process.env.AGENDA = "on";
});

beforeEach(() => {
  reset();
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const call: Call = { method: init?.method ?? "GET", url, body: init?.body as string | undefined };
    state.calls.push(call);
    // El refresh del access token lo responde siempre el mismo token de mentira.
    const answer = call.url.endsWith("/token")
      ? { status: 200, json: { access_token: "tok", expires_in: 3600 } }
      : state.respond(call);
    return new Response(JSON.stringify(answer.json ?? {}), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sincronización de tareas con Google Calendar", () => {
  it("apagado por defecto: sin credenciales no se hace ni una llamada", async () => {
    const { pushTaskEvent } = await load();
    state.creds = null;
    await pushTaskEvent("org_1", {
      id: "t1",
      kind: "caltodo",
      title: "Llamar a Ana",
      start: new Date("2026-10-08T15:00:00Z"),
    });
    expect(state.calls).toHaveLength(0);
    expect(state.saves).toHaveLength(0);
  });

  it("conectado pero con el interruptor en off tampoco escribe en el calendario", async () => {
    const { pushTaskEvent } = await load();
    state.creds = connected(false);
    await pushTaskEvent("org_1", {
      id: "t1",
      kind: "caltodo",
      title: "Llamar a Ana",
      start: new Date("2026-10-08T15:00:00Z"),
    });
    expect(state.calls).toHaveLength(0);
  });

  it("con la bandera de agenda apagada no se contacta a Google", async () => {
    const { pushTaskEvent } = await load();
    state.agenda = false;
    state.creds = connected();
    await pushTaskEvent("org_1", {
      id: "t1",
      kind: "caltodo",
      title: "Llamar a Ana",
      start: new Date("2026-10-08T15:00:00Z"),
    });
    expect(state.calls).toHaveLength(0);
  });

  it("una tarea con fecha crea el evento y guarda su id en la fila", async () => {
    const { pushTaskEvent } = await load();
    state.creds = connected();
    state.respond = (call) =>
      call.url.endsWith("/token")
        ? { status: 200, json: { access_token: "tok", expires_in: 3600 } }
        : { status: 200, json: { id: "evt_1" } };

    await pushTaskEvent("org_1", {
      id: "t1",
      kind: "caltodo",
      title: "Llamar a Ana",
      description: "Presupuesto",
      start: new Date("2026-10-08T15:00:00Z"),
      end: new Date("2026-10-08T16:00:00Z"),
    });

    const post = state.calls.find((c) => c.method === "POST" && c.url.includes("/events"));
    expect(post?.url).toContain("/calendars/primary/events");
    expect(JSON.parse(post?.body ?? "{}")).toMatchObject({
      summary: "Llamar a Ana",
      description: "Presupuesto",
      start: { dateTime: "2026-10-08T15:00:00.000Z" },
      end: { dateTime: "2026-10-08T16:00:00.000Z" },
      // Sin esto, un calendario sin avisos por defecto no notifica la tarea.
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
    });
    expect(state.saves).toEqual([{ googleEventId: "evt_1" }]);
  });

  it("una tarea ya sincronizada se MUEVE, no se duplica", async () => {
    const { pushTaskEvent } = await load();
    state.creds = connected();

    await pushTaskEvent("org_1", {
      id: "t1",
      kind: "caltodo",
      title: "Llamar a Ana",
      start: new Date("2026-10-09T15:00:00Z"),
      googleEventId: "evt_viejo",
    });

    const patch = state.calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toContain("/events/evt_viejo");
    expect(JSON.parse(patch?.body ?? "{}").start.dateTime).toBe("2026-10-09T15:00:00.000Z");
    expect(state.calls.filter((c) => c.method === "POST" && c.url.includes("/events"))).toHaveLength(0);
  });

  it("si Google ya no tiene el evento (404) se vuelve a crear y el id se reemplaza", async () => {
    const { pushTaskEvent } = await load();
    state.creds = connected();
    state.respond = (call) =>
      call.method === "PATCH"
        ? { status: 404, json: {} }
        : { status: 200, json: { id: "evt_nuevo" } };

    await pushTaskEvent("org_1", {
      id: "t1",
      kind: "caltodo",
      title: "Llamar a Ana",
      start: new Date("2026-10-09T15:00:00Z"),
      googleEventId: "evt_borrado",
    });

    expect(state.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(state.calls.some((c) => c.method === "POST" && c.url.includes("/events"))).toBe(true);
    expect(state.saves).toEqual([{ googleEventId: "evt_nuevo" }]);
  });

  it("si la tarea pierde su fecha se retira el evento y se olvida su id", async () => {
    const { pushTaskEvent } = await load();
    state.creds = connected();

    await pushTaskEvent("org_1", {
      id: "t1",
      kind: "caltodo",
      title: "Llamar a Ana",
      start: null,
      googleEventId: "evt_1",
    });

    expect(state.calls.some((c) => c.method === "DELETE" && c.url.includes("/events/evt_1"))).toBe(true);
    expect(state.saves).toEqual([{ googleEventId: null }]);
  });

  it("la tarea de proyecto va como evento de todo el día con el nombre del proyecto", async () => {
    const { pushTaskEvent } = await load();
    state.creds = connected();
    state.respond = () => ({ status: 200, json: { id: "evt_p" } });

    await pushTaskEvent("org_1", {
      id: "prjt_1",
      kind: "project",
      title: "Instalación",
      start: new Date("2026-10-12T12:00:00.000Z"),
      prefix: "Cafetería Norte",
    });

    const post = state.calls.find((c) => c.method === "POST" && c.url.includes("/events"));
    expect(JSON.parse(post?.body ?? "{}")).toMatchObject({
      summary: "[Cafetería Norte] Instalación",
      start: { date: "2026-10-12" },
      end: { date: "2026-10-13" },
      // Todo el día empieza a medianoche: 540 minutos = 9:00 del día límite.
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 540 }] },
    });
  });

  it("una tarea sin fecha no genera llamada y no toca Google", async () => {
    const { pushTaskEvent } = await load();
    state.creds = connected();

    await pushTaskEvent("org_1", { id: "t1", kind: "caltodo", title: "Idea", start: null });

    expect(state.calls).toHaveLength(0);
    expect(state.saves).toHaveLength(0);
  });

  it("syncTaskById relee la fila recién guardada y le pega su fecha", async () => {
    const { syncTaskById } = await load();
    state.creds = connected();
    state.respond = () => ({ status: 200, json: { id: "evt_9" } });
    state.selectRow = {
      id: "t1",
      title: "Reunión",
      details: "con el dueño",
      scheduledStart: new Date("2026-10-10T17:00:00Z"),
      scheduledEnd: new Date("2026-10-10T18:00:00Z"),
      duration: 60,
      googleEventId: null,
    };

    await syncTaskById("org_1", "t1");

    const post = state.calls.find((c) => c.method === "POST" && c.url.includes("/events"));
    expect(JSON.parse(post?.body ?? "{}").summary).toBe("Reunión");
    expect(state.saves).toEqual([{ googleEventId: "evt_9" }]);
  });

  it("un corte de Google nunca tumba la operación: se degrada con diagnóstico", async () => {
    const { pushTaskEvent, syncTaskById, taskEventIdFor, removeTaskEvent } = await load();
    state.creds = connected();
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNRESET");
    });

    await expect(
      pushTaskEvent("org_1", {
        id: "t1",
        kind: "caltodo",
        title: "Llamar a Ana",
        start: new Date("2026-10-08T15:00:00Z"),
      })
    ).resolves.toBeUndefined();
    await expect(syncTaskById("org_1", "t1")).resolves.toBeUndefined();
    await expect(removeTaskEvent("org_1", "evt_1")).resolves.toBeUndefined();

    expect(state.diagnostics.length).toBeGreaterThan(0);
    expect(state.diagnostics.every((d) => d.code === "tasks_sync_failed")).toBe(true);
    expect(await taskEventIdFor("org_1", "t1")).toBeNull();
  });

  it("taskEventIdFor devuelve null cuando la sincronización está apagada", async () => {
    const { taskEventIdFor, removeTaskEvent } = await load();
    state.creds = connected(false);
    state.selectRow = { id: "t1", googleEventId: "evt_1" };

    expect(await taskEventIdFor("org_1", "t1")).toBeNull();

    await removeTaskEvent("org_1", "evt_1");
    expect(state.calls).toHaveLength(0);
  });

  it("un refresh token revocado marca la conexión como rota", async () => {
    const { pushTaskEvent } = await load();
    state.creds = connected();
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );

    await pushTaskEvent("org_1", {
      id: "t1",
      kind: "caltodo",
      title: "Llamar a Ana",
      start: new Date("2026-10-08T15:00:00Z"),
    });

    expect(state.marked).toEqual(["org_1"]);
    expect(state.diagnostics).toHaveLength(1);
    expect(state.saves).toHaveLength(0);
  });

  it("el relleno sube las tareas con fecha que aún no tienen evento", async () => {
    const { syncPendingTasks } = await load();
    state.creds = connected();
    state.respond = () => ({ status: 200, json: { id: "evt_nuevo" } });
    state.rowsByTable = {
      caltodoTask: [
        {
          id: "t1",
          title: "Llamar a Ana",
          details: null,
          scheduledStart: new Date("2026-10-21T19:14:00Z"),
          scheduledEnd: null,
          duration: 60,
          googleEventId: null,
        },
      ],
      projectTask: [
        {
          id: "prjt_1",
          title: "Instalación",
          description: null,
          dueDate: new Date("2026-10-25T12:00:00Z"),
          googleEventId: null,
          projectName: "Cafetería Norte",
        },
      ],
    };

    const result = await syncPendingTasks("org_1");

    expect(result).toEqual({ synced: 2, failed: 0 });
    expect(state.saves).toEqual([
      { googleEventId: "evt_nuevo" },
      { googleEventId: "evt_nuevo" },
    ]);
    const bodies = state.calls
      .filter((c) => c.method === "POST" && c.url.includes("/events"))
      .map((c) => JSON.parse(c.body ?? "{}"));
    expect(bodies.map((b) => b.summary)).toEqual([
      "Llamar a Ana",
      "[Cafetería Norte] Instalación",
    ]);
  });

  it("el relleno se corta al primer rechazo de credenciales", async () => {
    const { syncPendingTasks } = await load();
    state.creds = connected();
    state.rowsByTable = {
      caltodoTask: [
        {
          id: "t1",
          title: "Una",
          details: null,
          scheduledStart: new Date("2026-10-21T19:14:00Z"),
          scheduledEnd: null,
          duration: 60,
          googleEventId: null,
        },
        {
          id: "t2",
          title: "Otra",
          details: null,
          scheduledStart: new Date("2026-10-22T19:14:00Z"),
          scheduledEnd: null,
          duration: 60,
          googleEventId: null,
        },
      ],
      projectTask: [],
    };
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await syncPendingTasks("org_1");

    // Un solo intento fallido, no dos: el token muerto no se repite.
    expect(result).toEqual({ synced: 0, failed: 1 });
    expect(state.marked).toEqual(["org_1"]);
  });

  it("sin el interruptor encendido el relleno no toca Google", async () => {
    const { syncPendingTasks } = await load();
    state.creds = connected(false);
    state.rowsByTable = {
      caltodoTask: [{ id: "t1", title: "Una" }],
      projectTask: [],
    };

    expect(await syncPendingTasks("org_1")).toEqual({ synced: 0, failed: 0 });
    expect(state.calls).toHaveLength(0);
  });
});
