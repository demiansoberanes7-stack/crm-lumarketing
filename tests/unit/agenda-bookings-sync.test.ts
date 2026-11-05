import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * 015 · B1 — Citas del CRM hacia Google Calendar (`bookings-sync`).
 *
 * La regla que sostiene todo el módulo es «UNA cita, UN evento». Con el conector
 * Google, el evento lo creó ya `createMeeting`: la sincronización debe ADOPTAR su
 * id y callar; si además creara el suyo, el calendario del dueño vería dos citas
 * por cada reserva. Con Zoom, enlace fijo o sin conector, el CRM sí crea su
 * evento y le escribe el enlace en la descripción.
 *
 * Lo segundo que se protege es el silencio: Google nunca puede tumbar una cita.
 * Todo fallo se degrada a diagnóstico, y el relleno se corta con un token revocado
 * en vez de martillar la API.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  agendaEnabled: vi.fn(),
  getBusinessGoogleCredentials: vi.fn(),
  markGoogleError: vi.fn(),
  googleFetch: vi.fn(),
  recordDiagnostic: vi.fn(),
}));

const state = {
  /**
   * Colas de filas por tabla: cada lectura se lleva el siguiente resultado.
   *
   * `syncPendingBookings` hace DOS consultas sobre `booking` (las del conector
   * Google y las demás) y este módulo no decide cuáles devuelve la base — lo que
   * se puede jurar sin Postgres es el SQL de cada una (ver el último test). Con
   * una sola lista fija, las dos lecturas verían las mismas filas y cada cita se
   * sincronizaría dos veces, que es justo el error que este archivo vigila.
   */
  rowsByTable: {} as Record<string, unknown[][]>,
  /** `where` capturados por tabla, para leer los filtros de verdad. */
  wheres: [] as { table: string; sql: string; params: unknown[] }[],
  saves: [] as Record<string, unknown>[],
  diagnostics: [] as { code?: string; metadata?: Record<string, unknown> }[],
  marked: [] as { organizationId: string; userId: string | null }[],
};

function render(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never);
}

function businessCreds(overrides: Record<string, unknown> = {}) {
  return {
    clientId: "cid",
    clientSecret: "secret",
    refreshToken: "refresh",
    calendarId: "primary",
    status: "connected",
    ...overrides,
  };
}

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bk_1",
    organizationId: "org_1",
    kind: "session",
    status: "confirmed",
    isTest: false,
    connector: "google",
    externalRef: "evt_meet_1",
    googleEventId: null,
    title: null,
    location: null,
    notes: null,
    meetingLink: "https://meet.google.com/abc-def-ghi",
    contactId: null,
    scheduledAt: new Date("2026-11-10T15:00:00.000Z"),
    durationMinutes: 45,
    ...overrides,
  };
}

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));
vi.mock("@/server/agenda/flag", () => ({
  agendaEnabled: mocks.agendaEnabled,
}));
vi.mock("@/server/agenda/connectors/google", () => ({
  googleFetch: mocks.googleFetch,
}));
vi.mock("@/server/agenda/connectors/google-credentials", () => ({
  getBusinessGoogleCredentials: mocks.getBusinessGoogleCredentials,
  markGoogleError: mocks.markGoogleError,
}));
vi.mock("@/server/diagnostics/logger", () => ({
  recordDiagnostic: mocks.recordDiagnostic,
}));

function fakeDb() {
  return {
    select: () => {
      const chain: Record<string, unknown> = {};
      let table = "";
      const rows = () => state.rowsByTable[table]?.shift() ?? [];
      chain.from = (source: unknown) => {
        table = getTableName(source as never);
        return chain;
      };
      chain.where = (condition: unknown) => {
        const query = render(condition);
        state.wheres.push({ table, sql: query.sql, params: query.params });
        return chain;
      };
      chain.orderBy = () => chain;
      chain.limit = () => Promise.resolve(rows());
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
        Promise.resolve(rows()).then(resolve);
      return chain;
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: unknown) => {
          const query = render(condition);
          state.saves.push(values);
          state.wheres.push({ table: "update", sql: query.sql, params: query.params });
          return Promise.resolve([]);
        },
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rowsByTable = {};
  state.wheres = [];
  state.saves = [];
  state.diagnostics = [];
  state.marked = [];
  mocks.getDb.mockReturnValue(fakeDb() as never);
  mocks.agendaEnabled.mockReturnValue(true);
  mocks.getBusinessGoogleCredentials.mockResolvedValue(businessCreds() as never);
  mocks.googleFetch.mockResolvedValue({ id: "evt_nuevo" } as never);
  mocks.markGoogleError.mockImplementation(
    async (organizationId: string, userId: string | null) => {
      state.marked.push({ organizationId, userId: userId ?? null });
    }
  );
  mocks.recordDiagnostic.mockImplementation(
    async (input: { code?: string; metadata?: Record<string, unknown> }) => {
      state.diagnostics.push(input);
    }
  );
});

function calls(method: string) {
  return mocks.googleFetch.mock.calls.filter(
    (c) => (c[2] as { method?: string })?.method === method
  );
}

async function load() {
  const mod = await import("@/server/agenda/bookings-sync");
  return mod;
}

describe("una cita, un evento", () => {
  it("conector Google: se ADOPTA el id del evento de Meet y no se llama a Google", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = { booking: [[bookingRow()]] };

    await syncBookingEvent("org_1", "bk_1");

    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(state.saves).toEqual([
      { googleEventId: "evt_meet_1", updatedAt: expect.any(Date) },
    ]);
  });

  it("conector Google sin external_ref: no se crea nada (lo crea la entrega de la reunión)", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = { booking: [[bookingRow({ externalRef: null, meetingLink: null })]] };

    await syncBookingEvent("org_1", "bk_1");

    // Crear el evento desde aquí sería duplicarlo en cuanto el operador pulsara
    // «Reintentar enlace».
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(state.saves).toHaveLength(0);
  });

  it("conector Google ya adoptado: ninguna escritura repetida", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = { booking: [[bookingRow({ googleEventId: "evt_meet_1" })]] };

    await syncBookingEvent("org_1", "bk_1");

    expect(state.saves).toHaveLength(0);
  });

  it("Zoom: el CRM crea SU evento y el enlace va en la descripción", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = {
      booking: [
        [
          bookingRow({
            connector: "zoom",
            externalRef: "zm_9",
            meetingLink: "https://zoom.us/j/999",
            title: "Revisión de cocina",
            location: "Showroom Norte",
            notes: "Traer catálogo",
          }),
        ],
      ],
    };

    await syncBookingEvent("org_1", "bk_1");

    const post = calls("POST")[0];
    expect(post?.[1]).toBe("/calendars/primary/events");
    expect(JSON.parse((post?.[2] as { body: string }).body)).toMatchObject({
      summary: "Revisión de cocina",
      location: "Showroom Norte",
      description: "Traer catálogo\n\nEnlace de la reunión: https://zoom.us/j/999",
      start: { dateTime: "2026-11-10T15:00:00.000Z", timeZone: "UTC" },
      end: { dateTime: "2026-11-10T15:45:00.000Z", timeZone: "UTC" },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
    });
    expect(state.saves).toEqual([
      { googleEventId: "evt_nuevo", updatedAt: expect.any(Date) },
    ]);
  });

  it("sin conector alguno: también tiene su evento en el calendario", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = {
      booking: [
        [bookingRow({ connector: null, externalRef: null, meetingLink: null, title: "Cita" })],
      ],
    };

    await syncBookingEvent("org_1", "bk_1");

    expect(calls("POST")).toHaveLength(1);
    // Descripción ausente, no vacía: un PATCH con "" borraría la que ya hubiera.
    expect(
      JSON.parse((calls("POST")[0]?.[2] as { body: string }).body).description
    ).toBeUndefined();
  });

  it("una cita con evento propio se MUEVE con PATCH, no se duplica", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = {
      booking: [[bookingRow({ connector: "zoom", googleEventId: "evt_viejo" })]],
    };

    await syncBookingEvent("org_1", "bk_1");

    expect(mocks.googleFetch).toHaveBeenCalledTimes(1);
    const [creds, path, init] = mocks.googleFetch.mock.calls[0] as [
      unknown,
      string,
      { method: string; body: string },
    ];
    expect(creds).toBeTruthy();
    expect(path).toBe("/calendars/primary/events/evt_viejo");
    expect(init.method).toBe("PATCH");
  });

  it("si Google ya no tiene el evento (404) se recrea y el id se reemplaza", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = {
      booking: [[bookingRow({ connector: "zoom", googleEventId: "evt_borrado" })]],
    };
    mocks.googleFetch.mockImplementation(
      async (_c: unknown, _p: string, init?: { method?: string }) =>
        init?.method === "PATCH" ? null : { id: "evt_nuevo" }
    );

    await syncBookingEvent("org_1", "bk_1");

    expect(calls("PATCH")).toHaveLength(1);
    expect(calls("POST")).toHaveLength(1);
    expect(state.saves).toEqual([
      { googleEventId: "evt_nuevo", updatedAt: expect.any(Date) },
    ]);
  });

  it("cancelada con conector Google: solo se olvida el id local", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = {
      booking: [[bookingRow({ status: "cancelada", googleEventId: "evt_meet_1" })]],
    };

    await syncBookingEvent("org_1", "bk_1");

    // `deleteMeeting` ya retiró el evento de Meet; borrarlo otra vez desde aquí
    // sería pelearse con un id que además puede no ser el del calendario.
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(state.saves).toEqual([
      { googleEventId: null, updatedAt: expect.any(Date) },
    ]);
  });

  it("cancelada con evento propio: se retira de Google y se olvida", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = {
      booking: [
        [
          bookingRow({
            connector: "zoom",
            status: "cancelada",
            googleEventId: "evt_1",
            meetingLink: null,
          }),
        ],
      ],
    };

    await syncBookingEvent("org_1", "bk_1");

    const del = calls("DELETE")[0];
    expect(del?.[1]).toBe("/calendars/primary/events/evt_1");
    expect((del?.[2] as { allow404?: boolean }).allow404).toBe(true);
    expect(state.saves).toEqual([{ googleEventId: null, updatedAt: expect.any(Date) }]);
  });

  it("el asunto sigue la regla de la pantalla: título propio o «Cita — <cliente>»", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = {
      booking: [[bookingRow({ connector: "enlace-fijo", title: "   ", contactId: "ct_1" })]],
      contact: [[{ name: "Ana Ríos" }]],
    };

    await syncBookingEvent("org_1", "bk_1");

    expect(JSON.parse((calls("POST")[0]?.[2] as { body: string }).body).summary).toBe(
      "Cita — Ana Ríos"
    );
  });

  it("una cita de prueba (Laboratorio) jamás llega a Google", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = { booking: [[bookingRow({ isTest: true })]] };

    await syncBookingEvent("org_1", "bk_1");

    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(state.saves).toHaveLength(0);
  });

  it("un bloque de agenda no se sincroniza: no tiene cliente ni reunión", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = { booking: [[bookingRow({ kind: "block", externalRef: null })]] };

    await syncBookingEvent("org_1", "bk_1");

    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(state.saves).toHaveLength(0);
  });

  it("sin bandera, sin calendario o marcado como roto: cero llamadas", async () => {
    const { syncBookingEvent } = await load();
    const zoom = [bookingRow({ connector: "zoom" })];
    // Dos lecturas: el intento con la bandera apagada ni llega a la base.
    state.rowsByTable = { booking: [zoom, zoom] };

    mocks.agendaEnabled.mockReturnValue(false);
    await syncBookingEvent("org_1", "bk_1");
    expect(mocks.googleFetch).not.toHaveBeenCalled();

    mocks.agendaEnabled.mockReturnValue(true);
    mocks.getBusinessGoogleCredentials.mockResolvedValue(null as never);
    await syncBookingEvent("org_1", "bk_1");
    expect(mocks.googleFetch).not.toHaveBeenCalled();

    mocks.getBusinessGoogleCredentials.mockResolvedValue(
      businessCreds({ status: "error" }) as never
    );
    await syncBookingEvent("org_1", "bk_1");
    expect(mocks.googleFetch).not.toHaveBeenCalled();
  });

  it("un corte de Google no tumba la cita: queda en diagnóstico", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = { booking: [[bookingRow({ connector: "zoom" })]] };
    mocks.googleFetch.mockRejectedValue(new Error("ECONNRESET"));

    await expect(syncBookingEvent("org_1", "bk_1")).resolves.toBeUndefined();

    expect(state.diagnostics.map((d) => d.code)).toEqual(["bookings_sync_failed"]);
    // Un fallo de red NO es credencial: Ajustes no debe pedir reconectar.
    expect(state.marked).toHaveLength(0);
  });

  it("un token revocado marca la fila del NEGOCIO, la única que usan las citas", async () => {
    const { syncBookingEvent } = await load();
    state.rowsByTable = {
      booking: [
        [bookingRow({ connector: "zoom" })],
        [bookingRow({ connector: "zoom" })],
      ],
    };
    mocks.googleFetch.mockRejectedValue(
      Object.assign(new Error("invalid_grant"), { isAuthError: true })
    );

    await syncBookingEvent("org_1", "bk_1");

    expect(state.marked).toEqual([{ organizationId: "org_1", userId: null }]);
  });
});

describe("relleno de citas (syncPendingBookings)", () => {
  it("las del conector Google se adoptan sin llamar a Google", async () => {
    const { syncPendingBookings } = await load();
    state.rowsByTable = {
      booking: [
        [bookingRow(), bookingRow({ id: "bk_2", externalRef: "evt_meet_2" })],
        [],
      ],
    };

    const result = await syncPendingBookings("org_1");

    expect(result).toEqual({ synced: 2, failed: 0 });
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(state.saves.map((s) => s.googleEventId)).toEqual(["evt_meet_1", "evt_meet_2"]);
  });

  it("las demás crean su evento", async () => {
    const { syncPendingBookings } = await load();
    state.rowsByTable = {
      booking: [
        [],
        [
          bookingRow({
            connector: "zoom",
            externalRef: "zm_1",
            meetingLink: "https://zoom.us/j/1",
          }),
        ],
      ],
    };

    const result = await syncPendingBookings("org_1");

    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(calls("POST")).toHaveLength(1);
  });

  it("el relleno se corta con el primer rechazo de credenciales", async () => {
    const { syncPendingBookings } = await load();
    state.rowsByTable = {
      booking: [
        [],
        [
          bookingRow({ connector: "zoom" }),
          bookingRow({ id: "bk_2", connector: "zoom", externalRef: "zm_2" }),
        ],
      ],
    };
    mocks.googleFetch.mockRejectedValue(
      Object.assign(new Error("invalid_grant"), { isAuthError: true })
    );

    const result = await syncPendingBookings("org_1");

    // Una sola intentona fallida, no dos: el token muerto no se repite.
    expect(result).toEqual({ synced: 0, failed: 1 });
    expect(mocks.googleFetch).toHaveBeenCalledTimes(1);
  });

  it("sin citas pendientes no se resuelven ni credenciales", async () => {
    const { syncPendingBookings } = await load();
    state.rowsByTable = { booking: [[], []] };

    expect(await syncPendingBookings("org_1")).toEqual({ synced: 0, failed: 0 });
    expect(mocks.getBusinessGoogleCredentials).not.toHaveBeenCalled();
  });

  it("los dos filtros: adopción para cualquier fecha, evento nuevo solo para citas futuras", async () => {
    const { syncPendingBookings } = await load();
    state.rowsByTable = { booking: [[], []] };
    vi.setSystemTime(new Date("2026-11-03T10:00:00.000Z"));
    try {
      await syncPendingBookings("org_1");
    } finally {
      vi.useRealTimers();
    }

    const adopt = state.wheres.find((w) => w.sql.includes("external_ref"));
    const create = state.wheres.filter((w) => w.table === "booking").at(-1);

    // Ambos leen solo sesiones reales sin evento, del tenant, y sin canceladas.
    // `cancelada` y `google` viajan como PARÁMETROS ligados (`status <> $4`), no
    // dentro del SQL: lo que se comprueba aquí es el filtro, no su literal.
    for (const where of [adopt, create]) {
      expect(where?.sql).toContain("organization_id");
      expect(where?.sql).toContain("kind");
      expect(where?.sql).toContain("is_test");
      expect(where?.sql).toContain("google_event_id");
      expect(where?.params).toContain("cancelada");
      expect(where?.params).toContain("google");
      expect(where?.params).toContain("session");
    }
    // La adopción es un escribir local: alcanza a las citas pasadas.
    expect(adopt?.sql).toContain('"booking"."connector" =');
    expect(adopt?.sql).not.toContain('"scheduled_at" >=');
    // Crear eventos del histórico llenaría el calendario del dueño de pasado.
    expect(create?.sql).toContain('"scheduled_at" >=');
  });
});
