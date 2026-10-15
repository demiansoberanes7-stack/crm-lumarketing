import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aislamiento multi-tenant de la creación de citas (Constitución III).
 *
 * La ruta manual (`POST /api/bookings`) trae `contactId` crudo del cliente.
 * Antes de este arreglo, un contactId de OTRA organización pasaba de largo:
 * `getContactName` devolvía "" y la cita se creaba igual, enlazando un
 * contacto ajeno. Aquí se fija que:
 *
 *  1. Un contactId inexistente o de otra organización ⇒ `not_found`, SIN cita.
 *  2. Un contactId que no corresponde a la conversación enviada ⇒ `invalid`.
 *  3. El camino legítimo (contacto propio, o contacto derivado de la
 *     conversación) sigue creando la cita.
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

vi.mock("@/server/agenda/settings", () => ({
  getSettings: async () => settings,
}));
vi.mock("@/server/agenda/availability", () => ({
  findSlot: async () => ({ startUtc: SLOT, endUtc: "…", label: "mié 5 ago, 09:00" }),
  computeAvailability: async () => [],
}));
vi.mock("@/server/agenda/offers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/offers")>();
  return {
    ...original,
    getOffers: async () => [{ startUtc: SLOT, label: "mié 5 ago, 09:00" }],
    replaceOffers: async () => {},
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
const inserted: unknown[] = [];

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin"]) c[m] = () => c;
  c.limit = () => Promise.resolve(rows);
  return c;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => chain(selectRows.shift() ?? []),
    insert: () => ({
      values: (v: unknown) => ({
        returning: () => {
          inserted.push(v);
          return Promise.resolve([
            { ...(v as object), scheduledAt: new Date(SLOT), meetingLink: null, linkPending: false, isTest: false, externalRef: null },
          ]);
        },
      }),
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: () => ({
          returning: () =>
            Promise.resolve([
              { id: "bk_1", organizationId: "org_1", scheduledAt: new Date(SLOT), durationMinutes: 30, isTest: false, connector: "enlace-fijo", notes: null, contactId: "ct_1", ...(v as object) },
            ]),
        }),
      }),
    }),
  }),
  schema: {
    booking: {},
    conversation: { organizationId: "organizationId", id: "id" },
    contact: { organizationId: "organizationId", id: "id", name: "name" },
    lead: { organizationId: "organizationId", contactId: "contactId" },
    pipelineStage: { organizationId: "organizationId" },
    offeredSlot: {},
  },
}));

describe("una cita nunca enlaza un contacto de otra organización", () => {
  beforeEach(() => {
    selectRows.length = 0;
    inserted.length = 0;
  });

  it("contactId ajeno ⇒ not_found y NO se crea la cita", async () => {
    const { createSessionBooking, BookingError } = await import(
      "@/server/agenda/service"
    );
    // La consulta del contacto (scoped por org) no encuentra la fila ajena.
    selectRows.push([]);

    const promise = createSessionBooking({
      organizationId: "org_1",
      contactId: "ct_ajeno",
      startUtc: SLOT,
      source: "manual",
      requireOffer: false,
    });

    await expect(promise).rejects.toBeInstanceOf(BookingError);
    await promise.catch((err) => {
      expect(err.code).toBe("not_found");
    });
    expect(inserted).toHaveLength(0);
  });

  it("contactId propio ⇒ la cita se crea", async () => {
    const { createSessionBooking } = await import("@/server/agenda/service");
    selectRows.push([{ name: "Ana" }]); // contacto propio
    selectRows.push([]); // sin lead

    const result = await createSessionBooking({
      organizationId: "org_1",
      contactId: "ct_1",
      startUtc: SLOT,
      source: "manual",
      requireOffer: false,
    });

    expect(inserted).toHaveLength(1);
    expect(result.booking.contactId).toBe("ct_1");
  });

  it("contactId que NO es el de la conversación ⇒ invalid, sin cita", async () => {
    const { createSessionBooking, BookingError } = await import(
      "@/server/agenda/service"
    );
    selectRows.push([{ contactId: "ct_de_la_conversacion", isTest: false }]);

    const promise = createSessionBooking({
      organizationId: "org_1",
      conversationId: "cv_1",
      contactId: "ct_otro",
      startUtc: SLOT,
      source: "manual",
      requireOffer: false,
    });

    await expect(promise).rejects.toBeInstanceOf(BookingError);
    await promise.catch((err) => {
      expect(err.code).toBe("invalid");
    });
    expect(inserted).toHaveLength(0);
  });

  it("contacto derivado de la conversación (sin contactId explícito) sigue funcionando", async () => {
    const { createSessionBooking } = await import("@/server/agenda/service");
    selectRows.push([{ contactId: "ct_1", isTest: false }]); // conversación
    selectRows.push([{ name: "Ana" }]); // contacto resuelto
    selectRows.push([]); // sin lead

    const result = await createSessionBooking({
      organizationId: "org_1",
      conversationId: "cv_1",
      startUtc: SLOT,
      source: "ai",
      requireOffer: true,
    });

    expect(inserted).toHaveLength(1);
    expect(result.booking.contactId).toBe("ct_1");
  });
});
