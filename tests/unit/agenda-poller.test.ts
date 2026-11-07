import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 015 · B1d — El poller de agenda.
 *
 * Los efectos de las rutas ya escriben en Google dentro de la petición; lo que
 * aporta este barrido es la REPARACIÓN de lo que se quedó sin evento. Por eso lo
 * que se prueba aquí no es «sabe sincronizar» (eso va en `bookings-sync` y
 * `tasks-sync`), sino las cuatro cosas que solo se ven en un proceso que se
 * repite solo:
 *  - sin bandera ni se registra, y dos barridos que se solapan no hacen dos veces
 *    el mismo trabajo;
 *  - las citas van SOLO a las organizaciones con calendario de NEGOCIO y las
 *    tareas a las que tienen el interruptor encendido — no al revés;
 *  - el fallo de una organización se anota y NO tumba el intervalo;
 *  - la marca del último barrido es informativa: si escribirla falla, el trabajo
 *    hecho no se pierde.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  agendaEnabled: vi.fn(),
  listGoogleCalendars: vi.fn(),
  syncPendingBookings: vi.fn(),
  syncGoogleCalendarEvents: vi.fn(),
  syncPendingTasks: vi.fn(),
}));

const state = {
  inserts: [] as Record<string, unknown>[],
  conflictTargets: [] as unknown[][],
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));
vi.mock("@/server/agenda/flag", () => ({ agendaEnabled: mocks.agendaEnabled }));
vi.mock("@/server/agenda/connectors/google-credentials", () => ({
  listGoogleCalendars: mocks.listGoogleCalendars,
}));
vi.mock("@/server/agenda/bookings-sync", () => ({
  syncPendingBookings: mocks.syncPendingBookings,
}));
vi.mock("@/server/agenda/google-events-import", () => ({
  syncGoogleCalendarEvents: mocks.syncGoogleCalendarEvents,
}));
vi.mock("@/server/agenda/tasks-sync", () => ({
  syncPendingTasks: mocks.syncPendingTasks,
}));

function fakeDb() {
  return {
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoUpdate: (config: { target?: unknown[] }) => {
          state.inserts.push(row);
          state.conflictTargets.push(config.target ?? []);
          return Promise.resolve([]);
        },
      }),
    }),
  };
}

/** El estado global del worker es del proceso: entre pruebas hay que limpiarlo. */
function resetWorkerGlobals() {
  const g = globalThis as typeof globalThis & {
    __agendaPoll?: ReturnType<typeof setInterval>;
    __agendaTick?: boolean;
  };
  if (g.__agendaPoll) clearInterval(g.__agendaPoll);
  g.__agendaPoll = undefined;
  g.__agendaTick = undefined;
}

async function load() {
  return import("@/server/agenda/poller");
}

const BUSINESS = { organizationId: "org_negocio", userId: null, syncTasks: false };
const BUSINESS_WITH_TASKS = { organizationId: "org_2", userId: null, syncTasks: true };
const PERSONAL_ONLY = { organizationId: "org_3", userId: "usr_a", syncTasks: true };
const PERSONAL_OFF = { organizationId: "org_4", userId: "usr_b", syncTasks: false };

beforeEach(() => {
  vi.clearAllMocks();
  state.inserts = [];
  state.conflictTargets = [];
  resetWorkerGlobals();
  mocks.getDb.mockReturnValue(fakeDb() as never);
  mocks.agendaEnabled.mockReturnValue(true);
  mocks.listGoogleCalendars.mockResolvedValue([BUSINESS] as never);
  mocks.syncPendingBookings.mockResolvedValue({ synced: 1, failed: 0 });
  mocks.syncGoogleCalendarEvents.mockResolvedValue({
    imported: 2,
    updated: 0,
    cancelled: 0,
    conflicts: 0,
    failed: 0,
  });
  mocks.syncPendingTasks.mockResolvedValue({ synced: 2, failed: 0 });
});

afterEach(() => {
  resetWorkerGlobals();
  vi.useRealTimers();
});

describe("un barrido", () => {
  it("sin la bandera de agenda no lee nada: registrarlo es inofensivo", async () => {
    mocks.agendaEnabled.mockReturnValue(false);
    const { runAgendaWorkerOnce } = await load();

    expect(await runAgendaWorkerOnce()).toEqual({
      orgs: 0,
      bookings: 0,
      googleEvents: 0,
      tasks: 0,
      failed: 0,
    });
    expect(mocks.listGoogleCalendars).not.toHaveBeenCalled();
  });

  it("las citas van al calendario del negocio y las tareas a quien las enciende", async () => {
    mocks.listGoogleCalendars.mockResolvedValue([
      BUSINESS,
      BUSINESS_WITH_TASKS,
      PERSONAL_ONLY,
      PERSONAL_OFF,
    ] as never);
    const { runAgendaWorkerOnce } = await load();

    const result = await runAgendaWorkerOnce();

    // `org_4` solo tiene una fila personal con el interruptor apagado: no hay
    // nada que reparar allí y no entra ni en el recuento.
    expect(result.orgs).toBe(3);
    expect(mocks.syncPendingBookings.mock.calls.map((c) => c[0])).toEqual([
      "org_negocio",
      "org_2",
    ]);
    expect(mocks.syncGoogleCalendarEvents.mock.calls.map((c) => c[0])).toEqual([
      "org_negocio",
      "org_2",
    ]);
    expect(mocks.syncPendingTasks.mock.calls.map((c) => c[0])).toEqual([
      "org_2",
      "org_3",
    ]);
    // El techo por organización y barrido: Google tiene su propio cupo.
    expect(mocks.syncPendingBookings).toHaveBeenCalledWith("org_negocio", 100);
  });

  it("una organización que solo tiene suyo no recibe sincronización de citas", async () => {
    mocks.listGoogleCalendars.mockResolvedValue([PERSONAL_ONLY] as never);
    const { runAgendaWorkerOnce } = await load();

    const result = await runAgendaWorkerOnce();

    expect(result).toEqual({ orgs: 1, bookings: 0, googleEvents: 0, tasks: 2, failed: 0 });
    expect(mocks.syncPendingBookings).not.toHaveBeenCalled();
  });

  it("dos barridos que se solapan: el segundo no trabaja", async () => {
    let release!: () => void;
    mocks.listGoogleCalendars.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve([BUSINESS]);
        })
    );
    const { runAgendaWorkerOnce } = await load();

    const first = runAgendaWorkerOnce();
    const second = await runAgendaWorkerOnce();
    expect(second).toEqual({ orgs: 0, bookings: 0, googleEvents: 0, tasks: 0, failed: 0 });

    release();
    await first;
    // La marca se escribe una vez, no dos.
    expect(state.inserts).toHaveLength(1);
  });

  it("el fallo de una organización se anota y el barrido sigue con las demás", async () => {
    mocks.listGoogleCalendars.mockResolvedValue([BUSINESS, BUSINESS_WITH_TASKS] as never);
    mocks.syncPendingBookings
      .mockRejectedValueOnce(new Error("Google cortó la conexión"))
      .mockResolvedValueOnce({ synced: 1, failed: 0 });
    const { runAgendaWorkerOnce } = await load();

    const result = await runAgendaWorkerOnce();

    expect(mocks.syncPendingBookings).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(0);
    expect(state.inserts.map((i) => i.lastStatus)).toEqual(["error", "ok"]);
    expect(String(state.inserts[0]!.lastError)).toContain("cortó la conexión");
  });

  it("las citas que no llegaron al calendario quedan contadas como fallo", async () => {
    mocks.syncPendingBookings.mockResolvedValue({ synced: 3, failed: 2 });
    const { runAgendaWorkerOnce } = await load();

    expect(await runAgendaWorkerOnce()).toEqual({
      orgs: 1,
      bookings: 3,
      googleEvents: 2,
      tasks: 0,
      failed: 2,
    });
    expect(state.inserts[0]).toMatchObject({ lastStatus: "error", provider: "google_calendar" });
  });

  it("anota el barrido en la tabla que ya existe para eso, sin duplicar la fila", async () => {
    const { runAgendaWorkerOnce } = await load();

    await runAgendaWorkerOnce();

    expect(state.inserts[0]).toMatchObject({
      organizationId: "org_negocio",
      provider: "google_calendar",
      lastStatus: "ok",
      detail: { bookings: 1, googleEvents: 2, googleConflicts: 0, tasks: 0 },
    });
    expect(state.inserts[0]!.lastSyncAt).toBeInstanceOf(Date);
    // Uno por negocio y proveedor: la clave única es (organization_id, provider).
    expect(state.conflictTargets[0]).toHaveLength(2);
  });

  it("si la marca no se puede escribir, el trabajo hecho no se pierde", async () => {
    mocks.getDb.mockImplementation(() => {
      throw new Error("charla de la base cortada");
    });
    const { runAgendaWorkerOnce } = await load();

    await expect(runAgendaWorkerOnce()).resolves.toEqual({
      orgs: 1,
      bookings: 1,
      googleEvents: 2,
      tasks: 0,
      failed: 0,
    });
  });
});

describe("el intervalo", () => {
  it("se registra una sola vez y dice estar listo", async () => {
    vi.useFakeTimers();
    const { agendaWorkerReady, startAgendaWorker } = await load();

    expect(agendaWorkerReady()).toBe(false);
    await startAgendaWorker();
    await startAgendaWorker();
    expect(agendaWorkerReady()).toBe(true);

    // El primer barrido va diferido: al arrancar el proceso todavía se están
    // compilando rutas.
    expect(mocks.listGoogleCalendars).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.listGoogleCalendars).toHaveBeenCalledTimes(1);

    mocks.listGoogleCalendars.mockClear();
    // El intervalo es de cinco minutos, medido desde el registro (no desde el
    // primer barrido): 60 + 300 segundos dan una sola pasada.
    await vi.advanceTimersByTimeAsync(300_000);
    // Un solo intervalo aunque se llamara dos veces: dos barridos simultáneos
    // duplicarían las llamadas a Google por cada cita pendiente.
    expect(mocks.listGoogleCalendars).toHaveBeenCalledTimes(1);
  });
});
