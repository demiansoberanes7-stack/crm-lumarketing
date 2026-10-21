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
  orderByCalls: [] as unknown[],
}));

let selectQueue: unknown[][] = [];

function render(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never);
}

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const method of ["from", "groupBy"]) c[method] = vi.fn(() => c);
  c.orderBy = vi.fn((...conditions: unknown[]) => {
    mocks.orderByCalls.push(...conditions);
    return c;
  });
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
  mocks.orderByCalls = [];
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

  it("sin prospectos de chat no consulta las oportunidades", async () => {
    selectQueue.push([]);
    const out = await listProspects({ organizationId: "org_1" });
    expect(out).toEqual([]);
    // Dos lecturas, no tres: la de chat, la de correo, y NINGUNA de `lead` —
    // sin filas no hay contactos cuyas etapas buscar.
    expect(mocks.select).toHaveBeenCalledTimes(2);
    const consultas = mocks.whereCalls.map((c) => render(c).sql);
    expect(consultas.some((s) => s.includes('"lead".'))).toBe(false);
    expect(consultas[1]).toContain('"email_message"."direction"');
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

describe("la oportunidad que se elige", () => {
  /**
   * `last_activity_at` es nullable y Postgres pone los NULL PRIMERO en un DESC:
   * sin `nulls last`, un lead sin actividad registrada le ganaba al que sí está
   * trabajando y la tarjeta mostraba la etapa vieja.
   */
  it("pone los leads sin actividad hasta el final", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1" });
    const orden = mocks.orderByCalls.map((c) => render(c).sql).join(" ");
    expect(orden).toMatch(/"lead"\."is_primary" desc/);
    expect(orden).toMatch(/"lead"\."last_activity_at" desc nulls last/);
  });
});

describe("las fechas llegan en la forma que trae el driver", () => {
  /**
   * Producción reventó la pestaña con `b.firstInboundAt?.toISOString is not a
   * function`: el MIN/MAX de un fragmento `sql` no lleva decodificador, así que
   * su tipo real lo decide el driver y no la anotación de TS. La normalización
   * del DTO tiene que aguantar cualquier forma sin lanzar.
   */
  async function one(row: Record<string, unknown>) {
    selectQueue.push([{ ...prospectRow, ...row }], []);
    const [out] = await listProspects({ organizationId: "org_1" });
    return out;
  }

  it("un Date se serializa en ISO", async () => {
    const row = await one({
      firstInboundAt: new Date("2026-10-18T15:00:00Z"),
      lastInboundAt: new Date("2026-10-20T15:00:00Z"),
    });
    expect(row?.firstInboundAt).toBe("2026-10-18T15:00:00.000Z");
    expect(row?.lastInboundAt).toBe("2026-10-20T15:00:00.000Z");
  });

  it("una cadena de Postgres se convierte a ISO", async () => {
    const row = await one({
      firstInboundAt: "2026-10-18T15:00:00",
      lastInboundAt: "2026-10-20T15:00:00.123456+00:00",
    });
    expect(row?.firstInboundAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(row?.lastInboundAt).toBe("2026-10-20T15:00:00.123Z");
  });

  it("null y cadena vacía salen como null", async () => {
    expect((await one({ firstInboundAt: null }))?.firstInboundAt).toBeNull();
    expect((await one({ firstInboundAt: "" }))?.firstInboundAt).toBeNull();
    expect((await one({ firstInboundAt: undefined }))?.firstInboundAt).toBeNull();
  });

  it("un valor sin formato de fecha no lanza: la pestaña se pinta igual", async () => {
    const row = await one({
      firstInboundAt: { hours: 3 } as unknown as Date,
      lastInboundAt: "no-es-fecha",
      archivedAt: "también-no-es-fecha",
    });
    expect(row?.firstInboundAt).toBeNull();
    expect(row?.lastInboundAt).toBeNull();
    expect(row?.archivedAt).toBeNull();
    expect(row?.name).toBe("Luis Pérez");
  });

  it("archivado con Date sigue saliendo en ISO", async () => {
    const row = await one({ archivedAt: new Date("2026-10-19T09:00:00Z") });
    expect(row?.archivedAt).toBe("2026-10-19T09:00:00.000Z");
  });
});

describe("el correo entrante también hace prospecto", () => {
  const emailRow = {
    email: "nancy.covarrubias@syscom.mx",
    firstInboundAt: new Date("2026-10-19T10:00:00Z"),
    lastInboundAt: new Date("2026-10-20T18:00:00Z"),
    inboundCount: 3,
    lastSubject: "Propuesta de mantenimiento",
  };

  it("entra en la lista sin ser contacto y sale sin ficha ni hilo", async () => {
    selectQueue.push([prospectRow], [], [emailRow]);
    const out = await listProspects({ organizationId: "org_1" });

    const correo = out.find((p) => p.channel === "email");
    expect(correo).toMatchObject({
      contactId: null,
      conversationId: null,
      email: "nancy.covarrubias@syscom.mx",
      name: "nancy.covarrubias@syscom.mx",
      phone: null,
      channelLabel: "Correo",
      lastInboundText: "Propuesta de mantenimiento",
      inboundCount: 3,
      lastInboundAt: "2026-10-20T18:00:00.000Z",
      archivedAt: null,
      stageName: null,
    });
  });

  /**
   * El criterio del dueño es «todo mensaje entrante», así que el orden no puede
   * ser «primero el chat»: gana el último mensaje, venga por donde venga.
   */
  it("ordina por el último mensaje entrante, no por la fuente", async () => {
    selectQueue.push([prospectRow], [], [emailRow]);
    const out = await listProspects({ organizationId: "org_1" });
    expect(out.map((p) => p.channel)).toEqual(["email", "instagram"]);

    selectQueue.push([prospectRow], [], [{ ...emailRow, lastInboundAt: null }]);
    const alReves = await listProspects({ organizationId: "org_1" });
    expect(alReves.map((p) => p.channel)).toEqual(["instagram", "email"]);
  });

  it("lleva el tenant y direction = inbound a la consulta", async () => {
    selectQueue.push([], [emailRow]);
    await listProspects({ organizationId: "org_1" });

    const { sql: text, params } = render(mocks.whereCalls[1]);
    expect(text).toContain('"email_message"."organization_id"');
    expect(text).toContain('"email_message"."direction"');
    expect(params).toContain("org_1");
    expect(params).toContain("inbound");
  });

  it("un canal de chat ni siquiera consulta el correo", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1", channel: "instagram" });
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.whereCalls.some((c) => render(c).sql.includes("email_message"))).toBe(false);
  });

  it("«con teléfono» y «archivados» tampoco consultan el correo", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1", phone: "tiene" });
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1", archived: true });
    expect(mocks.whereCalls.some((c) => render(c).sql.includes("email_message"))).toBe(false);
  });

  it("«sin teléfono» sí lo incluye: un remitente nunca deja número en el chat", async () => {
    selectQueue.push([], [emailRow]);
    const out = await listProspects({ organizationId: "org_1", phone: "falta" });
    expect(out).toHaveLength(1);
    expect(out[0]?.phone).toBeNull();
  });

  it("un % tecleado busca el símbolo en la dirección, no todas", async () => {
    selectQueue.push([], [emailRow]);
    await listProspects({ organizationId: "org_1", q: "100%" });
    const { params } = render(mocks.whereCalls[1]);
    expect(params).toContain("%100\\%%");
  });
});

describe("la búsqueda no acepta comodines del usuario", () => {
  it("un % tecleado busca el símbolo, no lista los 200 prospectos", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1", q: "100%" });
    const { params } = render(mocks.whereCalls[0]);
    expect(params).toContain("%100\\%%");
  });

  it("un guion bajo tampoco es el comodín de un caracter", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1", q: "a_b" });
    const { params } = render(mocks.whereCalls[0]);
    expect(params).toContain("%a\\_b%");
  });
});
