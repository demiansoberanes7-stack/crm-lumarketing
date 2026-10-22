import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema } from "@/lib/db";
import { listProspects } from "@/server/prospects/query";

/**
 * La vista de Prospectos (Constitución III y Contrato de datos).
 *
 * Lo que esta pantalla jura:
 *  - cada consulta lleva el tenant en el WHERE y en las dos condiciones de join,
 *    para que un hilo de otra organización no pueda colarse por la FK;
 *  - solo cuenta mensajes ENTRANTES de hilos REALES (ni `is_test`, ni salidas);
 *  - la etapa viene de la oportunidad principal del contacto;
 *  - el corte de 200 se aplica DESPUÉS de filtrar;
 *  - lo descartado queda fuera del WHERE, y dentro cuando se pide ver ocultos.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  select: vi.fn(),
  whereCalls: [] as unknown[],
  dismissalWhereCalls: [] as unknown[],
  joinCalls: [] as unknown[],
  limitCalls: [] as unknown[],
  orderByCalls: [] as unknown[],
}));

let selectQueue: unknown[][] = [];

/**
 * Contenido de `prospect_dismissal` que la prueba quiere ver.
 *
 * La lista hace UNA lectura de descartes por rama (contactos y correos) antes de
 * su consulta principal. Si esa lectura consumiera turno en `selectQueue`, las
 * 23 pruebas de este archivo tendrían que interpolar filas vacías sin decir por
 * qué; aquí se resuelve por `kind`, que es lo que la prueba realmente declara.
 */
let dismissals: { kind: "contact" | "email"; key: string; createdAt: Date }[] = [];

function render(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never);
}

function chain(rows: unknown[]) {
  const target = { rows };
  const c: Record<string, unknown> = {};
  let overDismissals = false;
  let dismissalKind: "contact" | "email" = "contact";

  // `from` es lo que distingue la lectura de descartes de las consultas de la
  // vista: las primeras no ensucian `whereCalls` ni gastan turno de `selectQueue`.
  c.from = vi.fn((table: unknown) => {
    overDismissals = table === schema.prospectDismissal;
    return c;
  });
  for (const method of ["groupBy"]) c[method] = vi.fn(() => c);
  c.orderBy = vi.fn((...conditions: unknown[]) => {
    mocks.orderByCalls.push(...conditions);
    return c;
  });
  c.innerJoin = vi.fn((_table: unknown, condition: unknown) => {
    mocks.joinCalls.push(condition);
    return c;
  });
  c.where = vi.fn((condition: unknown) => {
    if (overDismissals) {
      mocks.dismissalWhereCalls.push(condition);
      const { params } = render(condition);
      dismissalKind = params.includes("email") ? "email" : "contact";
      return c;
    }
    mocks.whereCalls.push(condition);
    return c;
  });
  c.limit = vi.fn((value: unknown) => {
    mocks.limitCalls.push(value);
    return c;
  });
  (c as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(
      overDismissals
        ? dismissals.filter((d) => d.kind === dismissalKind)
        : (selectQueue.shift() ?? target.rows)
    ).then(resolve);
  return c;
}

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  dismissals = [];
  mocks.whereCalls = [];
  mocks.dismissalWhereCalls = [];
  mocks.joinCalls = [];
  mocks.limitCalls = [];
  mocks.orderByCalls = [];
  mocks.getDb.mockReturnValue({
    select: mocks.select.mockImplementation(() => chain([])),
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
    // Cuatro lecturas, no cinco: descartes de chat, chat, descartes de correo y
    // correo. NINGUNA de `lead` — sin filas no hay contactos cuyas etapas buscar.
    expect(mocks.select).toHaveBeenCalledTimes(4);
    expect(mocks.dismissalWhereCalls).toHaveLength(2);
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
    // Descartes de chat, lista de chat y las etapas de esa página. El correo se
    // salta ENTERO, también su lectura de descartes.
    expect(mocks.select).toHaveBeenCalledTimes(3);
    expect(mocks.dismissalWhereCalls).toHaveLength(1);
    expect(mocks.whereCalls.some((c) => render(c).sql.includes("email_message"))).toBe(false);
  });

  it("«con teléfono» sí salta el correo: un remitente nunca tiene número", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1", phone: "tiene" });
    expect(mocks.whereCalls.some((c) => render(c).sql.includes("email_message"))).toBe(false);
  });

  /**
   * «Ver archivados y descartados» SÍ recorre el correo: sin esa lectura no hay
   * forma de restaurar un remitente que se descartó, porque no tiene ficha donde
   * marcarlo.
   */
  it("«archivados» también lee el correo para poder restaurar sus descartados", async () => {
    selectQueue.push([prospectRow], [emailRow]);
    await listProspects({ organizationId: "org_1", archived: true });
    const correos = mocks.whereCalls.filter((c) =>
      render(c).sql.includes("email_message")
    );
    expect(correos).toHaveLength(1);
    // Y sin el `not in` de descarte: aquí se quieren ver, no esconder.
    expect(render(correos[0]).sql).not.toContain("not in");
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

describe("descartar un prospecto", () => {
  /**
   * Prospectos es una vista: no hay fila que borrar. Lo que se guarda es la
   * clave (`contact.id` o el correo en minúsculas) en `prospect_dismissal` y la
   * consulta la excluye. El historial —contacto, hilos, mensajes, correos— no se
   * toca, así que ninguna de estas pruebas toca esas tablas.
   */
  it("sin descartes la consulta no lleva un `not in` vacío", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1" });
    // `contact.id not in ()` no es SQL válido: Postgres rechazaría la lista
    // entera y la pantalla la leería como «no hay prospectos».
    expect(render(mocks.whereCalls[0]).sql).not.toContain("not in");
  });

  it("un contacto descartado sale del WHERE de la lista", async () => {
    dismissals.push({
      kind: "contact",
      key: "ct_1",
      createdAt: new Date("2026-10-21T09:00:00Z"),
    });
    selectQueue.push([prospectRow], []);
    const out = await listProspects({ organizationId: "org_1" });

    const { sql: text, params } = render(mocks.whereCalls[0]);
    expect(text).toMatch(/"contact"\."id" not in/);
    expect(params).toContain("ct_1");
    expect(params).toContain("org_1");
    expect(out).toHaveLength(1);
  });

  it("la lectura de descartes va por su propio tenant y tipo", async () => {
    selectQueue.push([prospectRow], []);
    await listProspects({ organizationId: "org_1" });
    const [contactos] = mocks.dismissalWhereCalls.map((c) => render(c));
    expect(contactos?.sql).toContain('"prospect_dismissal"."organization_id"');
    expect(contactos?.sql).toContain('"prospect_dismissal"."kind"');
    expect(contactos?.params).toContain("org_1");
    expect(contactos?.params).toContain("contact");
  });

  it("con «archivados y descartados» el descartado se ve y trae su fecha", async () => {
    dismissals.push({
      kind: "contact",
      key: "ct_1",
      createdAt: new Date("2026-10-21T09:00:00Z"),
    });
    selectQueue.push([prospectRow], []);
    const out = await listProspects({ organizationId: "org_1", archived: true });

    expect(render(mocks.whereCalls[0]).sql).not.toContain("not in");
    expect(out[0]).toMatchObject({ contactId: "ct_1", dismissedAt: "2026-10-21T09:00:00.000Z" });
  });

  it("el correo descartado se excluye por su dirección en minúsculas", async () => {
    dismissals.push({
      kind: "email",
      key: "bot1@syscom.mx",
      createdAt: new Date("2026-10-21T09:00:00Z"),
    });
    selectQueue.push([], []);
    await listProspects({ organizationId: "org_1" });

    const correos = mocks.whereCalls.filter((c) =>
      render(c).sql.includes("email_message")
    );
    const { sql: text, params } = render(correos[0]);
    // `from_email` llega con las mayúsculas del servidor, así que se compara la
    // forma normalizada, no la columna tal cual.
    expect(text).toMatch(/lower\("email_message"\."from_email"\) not in/);
    expect(params).toContain("bot1@syscom.mx");
  });

  it("la tarjeta de un remitente descartado se pinta como descartada", async () => {
    dismissals.push({
      kind: "email",
      key: "nancy.covarrubias@syscom.mx",
      createdAt: new Date("2026-10-21T09:00:00Z"),
    });
    selectQueue.push([], [
      {
        email: "Nancy.Covarrubias@syscom.mx",
        firstInboundAt: new Date("2026-10-19T10:00:00Z"),
        lastInboundAt: new Date("2026-10-20T18:00:00Z"),
        inboundCount: 3,
        lastSubject: "Propuesta",
      },
    ]);
    const out = await listProspects({ organizationId: "org_1", archived: true });
    expect(out[0]).toMatchObject({
      email: "Nancy.Covarrubias@syscom.mx",
      dismissedAt: "2026-10-21T09:00:00.000Z",
    });
  });

  it("un remitente sin descarte sale con dismissedAt null", async () => {
    selectQueue.push([], [
      {
        email: "otro@syscom.mx",
        firstInboundAt: new Date("2026-10-19T10:00:00Z"),
        lastInboundAt: new Date("2026-10-20T18:00:00Z"),
        inboundCount: 1,
        lastSubject: "Hola",
      },
    ]);
    const out = await listProspects({ organizationId: "org_1" });
    expect(out[0]?.dismissedAt).toBeNull();
  });
});

