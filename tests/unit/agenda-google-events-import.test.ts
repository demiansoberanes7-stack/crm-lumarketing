import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  agendaEnabled: vi.fn(),
  getBusinessGoogleCredentials: vi.fn(),
  markGoogleError: vi.fn(),
  googleFetch: vi.fn(),
  recordDiagnostic: vi.fn(),
  publish: vi.fn(),
}));

const state = {
  rowsByTable: {} as Record<string, unknown[][]>,
  insertedBookings: [] as Record<string, unknown>[],
  syncWrites: [] as Record<string, unknown>[],
  updates: [] as { values: Record<string, unknown>; table: string; sql: string }[],
  selects: [] as { table: string; sql: string; params: unknown[] }[],
};

function render(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never);
}

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
        state.selects.push({ table, sql: query.sql, params: query.params });
        return chain;
      };
      chain.limit = () => Promise.resolve(rows());
      (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
        Promise.resolve(rows()).then(resolve);
      return chain;
    },
    insert: (tableObject: unknown) => {
      const table = getTableName(tableObject as never);
      return {
        values: (values: Record<string, unknown>) => ({
          onConflictDoUpdate: () => {
            state.syncWrites.push(values);
            return Promise.resolve([]);
          },
          returning: () => {
            state.insertedBookings.push(values);
            return Promise.resolve([values]);
          },
          then: (resolve: (value: unknown[]) => void) => {
            if (table === "sync_state") state.syncWrites.push(values);
            return Promise.resolve([]).then(resolve);
          },
        }),
      };
    },
    update: (tableObject: unknown) => {
      const table = getTableName(tableObject as never);
      return {
        set: (values: Record<string, unknown>) => ({
          where: (condition: unknown) => {
            state.updates.push({ values, table, sql: render(condition).sql });
            return Promise.resolve([]);
          },
        }),
      };
    },
  };
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "bk_existing",
    organizationId: "org_1",
    kind: "session",
    status: "agendada",
    source: "manual",
    contactId: null,
    projectId: null,
    conversationId: null,
    leadId: null,
    title: "Llamada original",
    location: null,
    userId: null,
    scheduledAt: new Date("2026-11-10T16:00:00.000Z"),
    durationMinutes: 30,
    connector: "enlace-fijo",
    externalRef: null,
    meetingLink: null,
    linkPending: false,
    googleEventId: "evt_1",
    isTest: false,
    notes: null,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    ...overrides,
  };
}

function calendarEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    status: "confirmed",
    eventType: "default",
    summary: "Revisión Google",
    description: "Revisar propuesta\n\nEnlace de la reunión: https://meet.google.com/abc-def-ghi",
    location: "Oficina",
    start: { dateTime: "2026-11-10T15:00:00.000Z" },
    end: { dateTime: "2026-11-10T15:45:00.000Z" },
    hangoutLink: "https://meet.google.com/abc-def-ghi",
    ...overrides,
  };
}

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));
vi.mock("@/server/agenda/flag", () => ({ agendaEnabled: mocks.agendaEnabled }));
vi.mock("@/server/agenda/connectors/google", () => ({ googleFetch: mocks.googleFetch }));
vi.mock("@/server/agenda/connectors/google-credentials", () => ({
  getBusinessGoogleCredentials: mocks.getBusinessGoogleCredentials,
  markGoogleError: mocks.markGoogleError,
}));
vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: mocks.recordDiagnostic }));
vi.mock("@/server/events/bus", () => ({ publish: mocks.publish }));

async function load() {
  return import("@/server/agenda/google-events-import");
}

beforeEach(() => {
  vi.resetAllMocks();
  state.rowsByTable = {};
  state.insertedBookings = [];
  state.syncWrites = [];
  state.updates = [];
  state.selects = [];
  mocks.getDb.mockReturnValue(fakeDb());
  mocks.agendaEnabled.mockReturnValue(true);
  mocks.getBusinessGoogleCredentials.mockResolvedValue({
    clientId: "client",
    clientSecret: "secret",
    refreshToken: "refresh",
    calendarId: "primary",
    status: "connected",
  });
  mocks.googleFetch.mockResolvedValue({ items: [], nextSyncToken: "sync-next" });
  mocks.recordDiagnostic.mockResolvedValue(undefined);
});

describe("Google Calendar → CRM", () => {
  it("importa un evento nuevo una sola vez con su id, hora, notas y enlace", async () => {
    state.rowsByTable = { sync_state: [[]], booking: [[], []] };
    mocks.googleFetch.mockResolvedValue({ items: [calendarEvent()], nextSyncToken: "sync-next" });
    const { syncGoogleCalendarEvents } = await load();

    const result = await syncGoogleCalendarEvents("org_1");

    expect(result).toMatchObject({ imported: 1, updated: 0, cancelled: 0, failed: 0 });
    expect(state.insertedBookings).toHaveLength(1);
    expect(state.insertedBookings[0]).toMatchObject({
      organizationId: "org_1",
      kind: "session",
      source: "google",
      status: "agendada",
      title: "Revisión Google",
      location: "Oficina",
      scheduledAt: new Date("2026-11-10T15:00:00.000Z"),
      durationMinutes: 45,
      googleEventId: "evt_1",
      meetingLink: "https://meet.google.com/abc-def-ghi",
      notes: "Revisar propuesta",
    });
    expect(mocks.publish).toHaveBeenCalledWith("org_1", {
      type: "booking.updated",
      data: { bookingId: expect.any(String) },
    });
    expect(mocks.googleFetch.mock.calls[0]?.[1]).toContain("singleEvents=true");
    expect(mocks.googleFetch.mock.calls[0]?.[1]).toContain("showDeleted=true");
    expect(state.syncWrites[0]?.detail).toMatchObject({
      calendarId: "primary",
      syncToken: "sync-next",
      syncing: false,
    });
  });

  it("actualiza la cita enlazada cuando Google la mueve o edita", async () => {
    const existing = booking();
    state.rowsByTable = { sync_state: [[]], booking: [[existing], []] };
    mocks.googleFetch.mockResolvedValue({
      items: [
        calendarEvent({
          summary: "Nueva hora",
          start: { dateTime: "2026-11-10T17:00:00Z" },
          end: { dateTime: "2026-11-10T17:45:00Z" },
        }),
      ],
      nextSyncToken: "sync-next",
    });
    const { syncGoogleCalendarEvents } = await load();

    const result = await syncGoogleCalendarEvents("org_1");

    expect(result).toMatchObject({ imported: 0, updated: 1, cancelled: 0, conflicts: 0, failed: 0 });
    expect(state.insertedBookings).toHaveLength(0);
    expect(state.updates).toContainEqual(
      expect.objectContaining({
        table: "booking",
        values: expect.objectContaining({
          title: "Nueva hora",
          scheduledAt: new Date("2026-11-10T17:00:00.000Z"),
          durationMinutes: 45,
        }),
      })
    );
  });

  it("refleja una cancelación de Google sin volver a borrar el evento", async () => {
    const existing = booking();
    state.rowsByTable = { sync_state: [[]], booking: [[existing]] };
    mocks.googleFetch.mockResolvedValue({
      items: [{ id: "evt_1", status: "cancelled" }],
      nextSyncToken: "sync-next",
    });
    const { syncGoogleCalendarEvents } = await load();

    const result = await syncGoogleCalendarEvents("org_1");

    expect(result.cancelled).toBe(1);
    expect(state.updates).toContainEqual(
      expect.objectContaining({ table: "booking", values: { status: "cancelada", updatedAt: expect.any(Date) } })
    );
  });

  it("no duplica una cita CRM que ya ocupa el horario de otro evento", async () => {
    const existing = booking({ googleEventId: null, scheduledAt: new Date("2026-11-10T15:00:00.000Z") });
    state.rowsByTable = { sync_state: [[]], booking: [[], [existing]] };
    mocks.googleFetch.mockResolvedValue({ items: [calendarEvent()], nextSyncToken: "sync-next" });
    const { syncGoogleCalendarEvents } = await load();

    const result = await syncGoogleCalendarEvents("org_1");

    expect(result).toMatchObject({ imported: 0, conflicts: 1, failed: 0 });
    expect(state.insertedBookings).toHaveLength(0);
    expect(mocks.recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ code: "google_calendar_booking_conflict" })
    );
  });

  it("usa el syncToken incremental del calendario del negocio", async () => {
    state.rowsByTable = {
      sync_state: [[{ detail: { calendarId: "primary", syncToken: "sync-old" } }]],
    };
    const { syncGoogleCalendarEvents } = await load();

    await syncGoogleCalendarEvents("org_1");

    expect(mocks.googleFetch.mock.calls[0]?.[1]).toContain("syncToken=sync-old");
    expect(mocks.googleFetch.mock.calls[0]?.[1]).toContain("/calendars/primary/events?");
  });

  it("reinicia un syncToken vencido con una sincronización completa segura", async () => {
    state.rowsByTable = { sync_state: [[{ detail: { calendarId: "primary", syncToken: "expired" } }]] };
    const expired = Object.assign(new Error("Gone"), { status: 410 });
    mocks.googleFetch.mockRejectedValue(expired);
    const { syncGoogleCalendarEvents } = await load();

    const result = await syncGoogleCalendarEvents("org_1");

    expect(result.failed).toBe(1);
    expect(state.syncWrites[0]?.detail).toMatchObject({ calendarId: "primary", syncing: true });
    expect((state.syncWrites[0]?.detail as Record<string, unknown>).syncToken).toBeUndefined();
  });
});
