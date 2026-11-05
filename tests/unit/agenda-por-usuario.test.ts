import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 0087/A2 — La agenda por persona.
 *
 * Lo que el pliego pide con «no todos los usuarios trabajan con los mismos
 * horarios» y lo que este diseño no puede romper: la entrega de la reunión es
 * del NEGOCIO. Si la fila personal gobernara el conector, configurar las horas
 * de una persona apagaría los enlaces Meet de toda la organización — y eso es
 * justamente la regresión que este archivo fija.
 */

const businessRow = {
  id: "cal_org",
  organizationId: "org_1",
  userId: null,
  weeklyHours: { mon: [{ start: "10:00", end: "14:00" }] },
  slotMinutes: 45,
  bufferMinutes: 15,
  minNoticeHours: 1,
  maxDaysAhead: 10,
  timezone: "America/Monterrey",
  connector: "google",
  meetingLink: "https://meet.google.com/sala-negocio",
};

const userRow = {
  id: "cal_usr",
  organizationId: "org_1",
  userId: "usr_1",
  weeklyHours: { mon: [{ start: "08:00", end: "12:00" }] },
  slotMinutes: 20,
  bufferMinutes: 0,
  minNoticeHours: 3,
  maxDaysAhead: 5,
  timezone: "America/Bogota",
  // El default de la columna: SI el lector lo respetara, Google dejaría de
  // entregar la reunión.
  connector: "enlace-fijo",
  meetingLink: null,
};

let rows: Record<string, unknown>[] = [];
const captured: { values?: Record<string, unknown>; conflict?: unknown } = {};

function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  // `getSettings` ya no hace `limit(1)`: espera dos filas como mucho y elige.
  c.then = (fn: (v: unknown) => unknown) => Promise.resolve(rows).then(fn);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain(),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.values = v;
        return {
          onConflictDoUpdate: (cfg: unknown) => {
            captured.conflict = cfg;
            return Promise.resolve();
          },
        };
      },
    }),
  }),
  schema: {
    calendarSettings: {
      organizationId: "organization_id",
      userId: "user_id",
    },
  },
}));

function expectBusiness(s: Awaited<ReturnType<typeof import("@/server/agenda/settings").getSettings>>) {
  expect(s.slotMinutes).toBe(45);
  expect(s.timezone).toBe("America/Monterrey");
}

describe("la cascada de horarios usuario → negocio → defaults", () => {
  beforeEach(() => {
    rows = [];
    delete captured.values;
    delete captured.conflict;
  });

  it("la fila personal manda en las horas, pero NO en la entrega", async () => {
    rows = [businessRow, userRow];
    const { getSettings } = await import("@/server/agenda/settings");
    const s = await getSettings("org_1", "usr_1");

    expect(s.slotMinutes).toBe(20);
    expect(s.timezone).toBe("America/Bogota");
    expect(s.weeklyHours.mon?.[0]?.start).toBe("08:00");
    // Y la entrega sigue siendo la del negocio:
    expect(s.connector).toBe("google");
    expect(s.meetingLink).toBe("https://meet.google.com/sala-negocio");
  });

  it("un usuario sin fila propia ve los horarios del negocio", async () => {
    rows = [businessRow, userRow];
    const { getSettings } = await import("@/server/agenda/settings");
    const s = await getSettings("org_1", "usr_otro");
    expectBusiness(s);
    expect(s.connector).toBe("google");
  });

  it("leer sin usuario devuelve la fila del negocio, aunque existan filas personales", async () => {
    rows = [businessRow, userRow];
    const { getSettings } = await import("@/server/agenda/settings");
    const s = await getSettings("org_1");
    expectBusiness(s);
  });

  it("sin ninguna fila, los defaults: la instancia recién encendida ya es usable", async () => {
    const { getSettings, DEFAULT_CALENDAR_SETTINGS } = await import(
      "@/server/agenda/settings"
    );
    expect(await getSettings("org_1")).toEqual(DEFAULT_CALENDAR_SETTINGS);
    expect(await getSettings("org_1", "usr_1")).toEqual(DEFAULT_CALENDAR_SETTINGS);
  });

  it("si solo existe la fila personal, esa fila sirve también de entrega", async () => {
    rows = [userRow];
    const { getSettings } = await import("@/server/agenda/settings");
    const s = await getSettings("org_1", "usr_1");
    expect(s.slotMinutes).toBe(20);
    expect(s.connector).toBe("enlace-fijo");
  });
});

describe("guardar la fila de una persona", () => {
  beforeEach(() => {
    rows = [businessRow, userRow];
    delete captured.values;
    delete captured.conflict;
  });

  it("escribe user_id y arbitra por (organización, usuario)", async () => {
    const { upsertSettings } = await import("@/server/agenda/settings");
    await upsertSettings(
      "org_1",
      { weeklyHours: { mon: [{ start: "07:00", end: "11:00" }] } },
      "usr_1"
    );

    expect(captured.values?.userId).toBe("usr_1");
    const target = (captured.conflict as { target: unknown[] }).target;
    expect(target).toEqual(["organization_id", "user_id"]);
  });

  it("lo que la persona no toca se hereda del negocio, no del default de la columna", async () => {
    // Es la primera vez que esta persona guarda: solo existe la fila del
    // negocio. Si el servicio usara el default de la columna, minNoticeHours
    // pasaría de 1 a 2 y la zona de Monterrey a Ciudad de México sin que nadie
    // lo pidiera.
    rows = [businessRow];
    const { upsertSettings } = await import("@/server/agenda/settings");
    await upsertSettings("org_1", { slotMinutes: 15 }, "usr_2");

    expect(captured.values?.slotMinutes).toBe(15);
    expect(captured.values?.minNoticeHours).toBe(1);
    expect(captured.values?.maxDaysAhead).toBe(10);
    expect(captured.values?.timezone).toBe("America/Monterrey");
  });

  it("sin usuario, la escritura es la fila del negocio (user_id null)", async () => {
    const { upsertSettings } = await import("@/server/agenda/settings");
    await upsertSettings("org_1", { slotMinutes: 60 });
    expect(captured.values?.userId).toBe(null);
  });
});
