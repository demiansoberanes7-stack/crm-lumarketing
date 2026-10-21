import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { listProspects } from "@/server/prospects/query";

/**
 * La vista de Prospectos (Constitución III y Contrato de datos).
 *
 * Lo que esta pantalla jura:
 *  - cada consulta lleva el tenant en el WHERE y en las dos condiciones de join,
 *    para que un hilo de otra organización no pueda colarse por la FK;
 *  - solo cuenta mensajes ENTRANTES de hilos REALES (ni `is_test`, ni salidas);
 *  - la etapa viene de la oportunidad principal del contacto;
 *  - el corte de 200 se aplica DESPUÉS de filtrar.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  select: vi.fn(),
  whereCalls: [] as unknown[],
  joinCalls: [] as unknown[],
  limitCalls: [] as unknown[],
}));

let selectQueue: unknown[][] = [];

function render(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never);
}

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const method of ["from", "groupBy", "orderBy"]) c[method] = vi.fn(() => c);
  c.innerJoin = vi.fn((_table: unknown, condition: unknown) => {
    mocks.joinCalls.push(condition);
    return c;
  });
  c.where = vi.fn((condition: unknown) => {
    mocks.whereCalls.push(condition);
    return c;
  });
  c.limit = vi.fn((value: unknown) => {
    mocks.limitCalls.push(value);
    return c;
  });
  (c as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return c;
}

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  mocks.whereCalls = [];
  mocks.joinCalls = [];
  mocks.limitCalls = [];
  mocks.getDb.mockReturnValue({
    select: mocks.select.mockImplementation(() => chain(selectQueue.shift() ?? [])),
  });
});

const prospectRow = {
  contactId: "ct_1",
  name: "Luis Pérez",
  phone: "4621345678",
  channel: "instagram",
  conversationId: "cv_1",
  archivedAt: null,
  firstInboundAt: new Date("2026-10-18T15:00:00Z"),
  lastInboundAt: new Date("2026-10-20T15:00:00Z"),
  inboundCount: 3,
  lastInboundText: "me interesa, mi cel es 4621345678",
};

describe("tenant y scope de la consulta de prospectos", () => {
  it("filtra mensajes entrantes del tenant", async () => {
    selectQueue.push([prospectRow], []);

    await listProspects({ organizationId: "org_1" });

    const main = render(mocks.whereCalls[0]);
    expect(main.sql).toContain('"message"."organization_id"');
    expect(main.sql).toContain('"message"."direction"');
    expect(main.sql).toContain('"contact"."archived_at" is null');
    expect(main.params).toContain("org_1");
    expect(main.params).toContain("in");
  });

  it("el join de hilos exige el tenant y descarta el hilo de pruebas", async () => {
    selectQueue.push([prospectRow], []);

    await listProspects({ organizationId: "org_1" });

    const convo = render(mocks.joinCalls[0]);
    expect(convo.sql).toContain('"conversation"."organization_id"');
    expect(convo.sql).toContain('"conversation"."is_test"');
    expect(convo.params).toContain("org_1");
    expect(convo.params).toContain(false);
  });

  it("repite el tenant en las tres condiciones de join", async () => {
    selectQueue.push([prospectRow], []);

    await listProspects({ organizationId: "org_1" });

    // hilos, contactos y la etapa del lead: ninguno puede casar por id con una
    // fila de otra organización.
    expect(mocks.joinCalls).toHaveLength(3);
    for (const condition of mocks.joinCalls) {
      const { sql: text, params } = render(condition);
      expect(text).toContain("organization_id");
      expect(params).toContain("org_1");
    }
  });

  it("corta en 200 después de agrupar", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1" });
    expect(mocks.limitCalls[0]).toBe(200);
  });
});

describe("filtros", () => {
  it("«sin teléfono» agrega contact.phone is null", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1", phone: "falta" });
    const { sql: text } = render(mocks.whereCalls[0]);
    expect(text).toMatch(/"contact"\."phone" is null/);
  });

  it("«con teléfono» agrega contact.phone is not null", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1", phone: "tiene" });
    const { sql: text } = render(mocks.whereCalls[0]);
    expect(text).toMatch(/"contact"\."phone" is not null/);
  });

  it("canal y búsqueda por nombre viajan a la consulta, no al cliente", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1", channel: "instagram", q: "luis" });
    const { sql: text, params } = render(mocks.whereCalls[0]);
    expect(text).toContain('"contact"."channel"');
    expect(text).toContain("translate");
    expect(params).toContain("instagram");
    expect(params.some((p) => typeof p === "string" && p.includes("%luis%"))).toBe(true);
  });

  it("sin prospectos no consulta las oportunidades", async () => {
    selectQueue.push([]);
    const out = await listProspects({ organizationId: "org_1" });
    expect(out).toEqual([]);
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });
});

describe("etapa y forma del DTO", () => {
  it("toma la primera oportunidad (la principal) y deja la segunda", async () => {
    selectQueue.push(
      [prospectRow],
      [
        { contactId: "ct_1", stageName: "Contacto", priority: "alta", amountCents: 500000 },
        { contactId: "ct_1", stageName: "Cerrado", priority: "baja", amountCents: 1 },
      ]
    );

    const [row] = await listProspects({ organizationId: "org_1" });
    expect(row?.stageName).toBe("Contacto");
    expect(row?.priority).toBe("alta");
    expect(row?.amountCents).toBe(500000);
  });

  it("un contacto sin lead sigue en la lista, con etapa null", async () => {
    selectQueue.push([prospectRow], []);
    const [row] = await listProspects({ organizationId: "org_1" });
    expect(row?.stageName).toBeNull();
    expect(row?.priority).toBeNull();
  });

  it("serializa fechas en ISO y traduce el canal", async () => {
    selectQueue.push([{ ...prospectRow, phone: null }], []);
    const [row] = await listProspects({ organizationId: "org_1" });
    expect(row).toMatchObject({
      contactId: "ct_1",
      name: "Luis Pérez",
      phone: null,
      channel: "instagram",
      channelLabel: "Instagram",
      conversationId: "cv_1",
      firstInboundAt: "2026-10-18T15:00:00.000Z",
      lastInboundAt: "2026-10-20T15:00:00.000Z",
      inboundCount: 3,
    });
  });

  it("el lead se consulta acotado a los contactos de la página", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1" });
    const leadWhere = render(mocks.whereCalls[1]);
    expect(leadWhere.sql).toContain('"lead"."organization_id"');
    expect(leadWhere.sql).toContain('"lead"."contact_id" in (');
    expect(leadWhere.params).toContain("ct_1");
    expect(leadWhere.params).toContain("org_1");
  });
});
