import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 0087/A2 — El candado anti-encimado.
 *
 * El índice único parcial de `booking` solo ve el instante EXACTO: dos citas a
 * las 09:00 chocan, pero una de 60 minutos a las 09:00 y otra de 30 a las 09:30
 * no chocan con ninguna llave y el cliente se queda con dos reuniones
 * cabalgadas. Lo que cierra eso es la transacción: candado por negocio +
 * chequeo de solape ANTES de escribir.
 *
 * Se fija aquí (no en el arnés E2E) que la traducción es `slot_taken` con
 * alternativas y que NO se escribe nada.
 */

const settings = {
  weeklyHours: { wed: [{ start: "09:00", end: "18:00" }] },
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 0,
  maxDaysAhead: 7,
  timezone: "America/Mexico_City",
  connector: "enlace-fijo" as const,
  meetingLink: "https://meet.ejemplo.com/sala",
};

const SLOT = "2026-08-05T15:00:00.000Z";
const SLOT_END = "2026-08-05T15:30:00.000Z";

/** Registro de lo que hizo la transacción, en orden. */
const calls: string[] = [];
/** Lo que responde el chequeo de solape: id que estorba o `null`. */
let clash: string | null = null;

const inserted: unknown[] = [];
const updated: unknown[] = [];
const replaceOffers = vi.fn(async () => {});

vi.mock("@/server/agenda/settings", () => ({
  getSettings: async () => settings,
}));

vi.mock("@/server/agenda/availability", () => ({
  findSlot: async () => ({ startUtc: SLOT, endUtc: SLOT_END, label: "mié 5 ago, 09:00" }),
  computeAvailability: async () => [
    { startUtc: "2026-08-05T16:00:00.000Z", endUtc: "…", label: "mié 5 ago, 10:00" },
  ],
  lockBookingSlots: async () => {
    calls.push("lock");
  },
  findSlotClash: async () => {
    calls.push("clash");
    return clash;
  },
}));

vi.mock("@/server/agenda/offers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/offers")>();
  return {
    ...original,
    getOffers: async () => [{ startUtc: SLOT, label: "mié 5 ago, 09:00" }],
    replaceOffers,
    clearOffers: async () => {},
  };
});

vi.mock("@/server/agenda/connectors", () => ({
  bindConnector: async () => ({
    id: "enlace-fijo",
    createMeeting: async () => ({ externalId: null, joinUrl: settings.meetingLink }),
    updateMeeting: async () => {},
    deleteMeeting: async () => {},
    testConnection: async () => ({ ok: true }),
  }),
  markConnectorAuthError: async () => {},
}));

vi.mock("@/server/leads/stage-history", () => ({ moveLeadToStage: async () => ({ ok: true }) }));
vi.mock("@/server/events/bus", () => ({ publish: () => {} }));
vi.mock("@/server/webhooks/dispatcher", () => ({ publishWebhook: async () => {} }));

const selectRows: unknown[][] = [];

function chain(rows: unknown[] = []) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin", "innerJoin"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

const dbMock: Record<string, unknown> = {
  select: () => chain(selectRows.shift() ?? []),
  insert: () => ({
    values: (v: unknown) => ({
      returning: () => {
        inserted.push(v);
        return Promise.resolve([
          {
            ...(v as object),
            scheduledAt: new Date(SLOT),
            meetingLink: null,
            linkPending: false,
            isTest: false,
            externalRef: null,
          },
        ]);
      },
    }),
  }),
  update: () => ({
    set: (v: unknown) => ({
      where: () => ({
        returning: () => {
          updated.push(v);
          return Promise.resolve([
            {
              id: "bk_1",
              organizationId: "org_1",
              scheduledAt: new Date(SLOT),
              durationMinutes: 30,
              isTest: false,
              connector: "enlace-fijo",
              notes: null,
              contactId: "ct_1",
              ...(v as object),
            },
          ]);
        },
      }),
    }),
  }),
  execute: async () => [],
  transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(dbMock),
};

vi.mock("@/lib/db", () => ({
  getDb: () => dbMock,
  schema: {
    booking: {},
    conversation: { organizationId: "organizationId", id: "id" },
    contact: { organizationId: "organizationId", id: "id", name: "name" },
    lead: { organizationId: "organizationId", contactId: "contactId" },
    pipelineStage: { organizationId: "organizationId" },
    offeredSlot: {},
  },
}));

function primeManual() {
  selectRows.push([{ name: "Ana" }]); // el contacto existe en ESTA organización
  selectRows.push([{ id: "ld_1" }]); // su lead
}

describe("el solape cierra la puerta antes de escribir", () => {
  beforeEach(() => {
    calls.length = 0;
    selectRows.length = 0;
    inserted.length = 0;
    updated.length = 0;
    clash = null;
    replaceOffers.mockClear();
  });

  it("con algo encima del intervalo: slot_taken, con alternativas y SIN inserción", async () => {
    const { createSessionBooking, BookingError } = await import(
      "@/server/agenda/service"
    );
    primeManual();
    clash = "bk_de_otro";

    const promise = createSessionBooking({
      organizationId: "org_1",
      contactId: "ct_1",
      startUtc: SLOT,
      source: "manual",
      requireOffer: false,
    });

    await expect(promise).rejects.toBeInstanceOf(BookingError);
    await promise.catch((err) => {
      expect(err.code).toBe("slot_taken");
      expect(err.slots).toHaveLength(1);
    });
    expect(inserted).toHaveLength(0);
    // El orden importa: sin el candado tomado antes de leer, dos transacciones
    // leen «libre» a la vez y las dos escriben.
    expect(calls).toEqual(["lock", "clash"]);
  });

  it("el candado por negocio se pide también al bloquear y al reprogramar", async () => {
    const { createBlock, rescheduleBooking } = await import(
      "@/server/agenda/service"
    );
    clash = "bk_otra";

    await expect(
      createBlock({
        organizationId: "org_1",
        startUtc: SLOT,
        durationMinutes: 60,
      })
    ).rejects.toMatchObject({ code: "slot_taken" });
    expect(inserted).toHaveLength(0);

    selectRows.push([
      {
        id: "bk_1",
        organizationId: "org_1",
        kind: "session",
        status: "agendada",
        source: "manual",
        scheduledAt: new Date(SLOT),
        durationMinutes: 60,
        isTest: false,
        connector: "enlace-fijo",
        meetingLink: null,
        linkPending: false,
        externalRef: null,
        notes: null,
        contactId: "ct_1",
      },
    ]);
    await expect(
      rescheduleBooking({
        organizationId: "org_1",
        bookingId: "bk_1",
        startUtc: SLOT,
      })
    ).rejects.toMatchObject({ code: "slot_taken" });
    expect(updated).toHaveLength(0);
    expect(calls.filter((c) => c === "lock")).toHaveLength(2);
  });

  it("hueco libre: se escribe la duración pedida, el título y el responsable", async () => {
    const { createSessionBooking } = await import("@/server/agenda/service");
    primeManual();

    const result = await createSessionBooking({
      organizationId: "org_1",
      contactId: "ct_1",
      userId: "usr_1",
      startUtc: SLOT,
      durationMinutes: 60,
      title: "Revisión de contrato",
      location: "Sede Centro",
      source: "manual",
      requireOffer: false,
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userId: "usr_1",
      durationMinutes: 60,
      title: "Revisión de contrato",
      location: "Sede Centro",
    });
    expect(result.booking.scheduledAt.toISOString()).toBe(SLOT);
  });

  it("una cita manual sin contacto se crea; en el camino del bot sigue siendo error", async () => {
    const { createSessionBooking } = await import("@/server/agenda/service");

    await createSessionBooking({
      organizationId: "org_1",
      startUtc: SLOT,
      source: "manual",
      requireOffer: false,
      title: "Llamada de mostrador",
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ contactId: null, leadId: null });

    // La conversación existe pero no tiene contacto: aquí la cita no puede
    // crearse, porque no hay a quién atender.
    selectRows.push([{ contactId: null, isTest: false }]);
    await expect(
      createSessionBooking({
        organizationId: "org_1",
        conversationId: "cv_1",
        startUtc: SLOT,
        source: "ai",
        requireOffer: true,
      })
    ).rejects.toMatchObject({ code: "invalid" });
    expect(inserted).toHaveLength(1);
  });

  it("una duración basura no se cuela: se queda la rejilla configurada", async () => {
    const { createSessionBooking } = await import("@/server/agenda/service");
    primeManual();

    await createSessionBooking({
      organizationId: "org_1",
      contactId: "ct_1",
      startUtc: SLOT,
      durationMinutes: Number.NaN,
      source: "manual",
      requireOffer: false,
    });
    expect(inserted[0]).toMatchObject({ durationMinutes: 30 });
  });
});
