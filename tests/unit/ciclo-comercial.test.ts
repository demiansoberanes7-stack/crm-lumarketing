import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canTransitionServiceOrder,
  isTerminalServiceOrderStatus,
} from "@/lib/service-order";
import {
  inferProjectTypeFromQuoteItems,
  pickProjectForQuote,
} from "@/server/projects/from-quote";
import { changeQuoteStatus } from "@/server/quotes/service";
import { ensureServiceOrderTx } from "@/server/service-orders/service";

/**
 * Fase C — Ciclo comercial (P1): cotización aceptada → proyecto → orden de
 * servicio.
 *
 * Cubre lo que la arquitectura exige probar sin tocar la BD real:
 *  1. La heurística de tipo de proyecto y el emparejamiento de proyectos
 *     existentes (aislamiento: no cruza clientes).
 *  2. El contrato de transiciones de la orden de servicio.
 *  3. El cableado en `changeQuoteStatus`: conversión en la MISMA transacción,
 *     webhooks post-commit y best-effort de Calendar.
 *  4. La idempotencia de la orden de servicio (una sola OS por cotización).
 *  5. La migración aditiva 0069 registrada en el journal.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  publishWebhook: vi.fn(),
  acceptQuoteIntoProjectTx: vi.fn(),
  syncTaskById: vi.fn(),
  inserted: [] as Record<string, unknown>[],
}));

let selectQueue: unknown[][] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "orderBy", "limit", "for", "offset", "set"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.where = vi.fn(() => chain);
  (chain as { then: unknown }).then = (resolveFn: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolveFn);
  return chain;
}

const db = {
  execute: mocks.execute,
  select: mocks.select,
  insert: mocks.insert,
  update: mocks.update,
  delete: mocks.delete,
  transaction: (work: (tx: unknown) => Promise<unknown>) => work(db),
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/webhooks/dispatcher", () => ({ publishWebhook: mocks.publishWebhook }));
vi.mock("@/server/projects/from-quote", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/projects/from-quote")>(),
  acceptQuoteIntoProjectTx: mocks.acceptQuoteIntoProjectTx,
}));
vi.mock("@/server/agenda/tasks-sync", () => ({ syncTaskById: mocks.syncTaskById }));

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  mocks.inserted = [];
  mocks.getDb.mockReturnValue(db);
  mocks.execute.mockResolvedValue(undefined);
  mocks.select.mockImplementation(() => thenableChain(selectQueue.shift() ?? []));
  mocks.update.mockReturnValue({ set: () => ({ where: () => Promise.resolve([]) }) });
  mocks.delete.mockReturnValue({ where: () => Promise.resolve([]) });
  mocks.insert.mockImplementation((payload: Record<string, unknown>) => ({
    values: (value: Record<string, unknown>) => {
      mocks.inserted.push({ ...payload, ...value } as Record<string, unknown>);
      return Promise.resolve([]);
    },
    onConflictDoNothing: () => Promise.resolve([]),
  }));
  mocks.acceptQuoteIntoProjectTx.mockResolvedValue({
    projectId: "prj_1",
    serviceOrderId: "os_1",
    projectCreated: true,
    serviceOrderCreated: true,
    projectCode: "PRJ-0007",
    serviceOrderCode: "OS-0001",
    taskIds: ["prjt_1", "prjt_2"],
  });
  mocks.syncTaskById.mockResolvedValue(undefined);
});

describe("inferProjectTypeFromQuoteItems", () => {
  it("un override explícito manda sobre la heurística", () => {
    expect(inferProjectTypeFromQuoteItems([{ name: "Hosting" }], "maintenance")).toBe("maintenance");
  });

  it("heurística: mantenimiento de equipo → maintenance", () => {
    expect(inferProjectTypeFromQuoteItems([{ name: "Formateo de laptop" }])).toBe("maintenance");
  });

  it("heurística: landing page → web_service", () => {
    expect(inferProjectTypeFromQuoteItems([{ name: "Landing page" }])).toBe("web_service");
  });

  it("heurística: campaña de Facebook Ads → marketing", () => {
    expect(inferProjectTypeFromQuoteItems([{ name: "Campaña Facebook Ads" }])).toBe("marketing");
  });

  it("ante la duda no inventa: cae en el default documentado", () => {
    expect(inferProjectTypeFromQuoteItems([{ name: "Sillas de oficina" }])).toBe("marketing");
  });
});

describe("pickProjectForQuote (aislamiento)", () => {
  const base = {
    contactId: "ct_1",
    projectType: "web_service",
    status: "en_proceso",
    archivedAt: null,
  };

  it("mismo cliente + mismo tipo + vivo ⇒ se vincula", () => {
    expect(pickProjectForQuote([{ id: "prj_1", ...base }], "ct_1", "web_service")).toBe("prj_1");
  });

  it("cliente distinto ⇒ no se vincula (nunca cruza clientes)", () => {
    expect(pickProjectForQuote([{ id: "prj_1", ...base }], "ct_2", "web_service")).toBeNull();
  });

  it("tipo distinto ⇒ no se vincula", () => {
    expect(pickProjectForQuote([{ id: "prj_1", ...base }], "ct_1", "marketing")).toBeNull();
  });

  it("proyecto archivado ⇒ no se vincula", () => {
    expect(
      pickProjectForQuote(
        [{ id: "prj_1", ...base, archivedAt: new Date() }],
        "ct_1",
        "web_service"
      )
    ).toBeNull();
  });

  it("proyecto cerrado ⇒ no se vincula", () => {
    expect(
      pickProjectForQuote([{ id: "prj_1", ...base, status: "completado" }], "ct_1", "web_service")
    ).toBeNull();
  });

  it("cotización sin cliente ⇒ se crea proyecto nuevo", () => {
    expect(pickProjectForQuote([{ id: "prj_1", ...base }], null, "web_service")).toBeNull();
  });
});

describe("transiciones de orden de servicio", () => {
  it("flujo normal hasta entregada", () => {
    expect(canTransitionServiceOrder("pendiente", "asignada")).toBe(true);
    expect(canTransitionServiceOrder("asignada", "en_proceso")).toBe(true);
    expect(canTransitionServiceOrder("en_proceso", "en_revision")).toBe(true);
    expect(canTransitionServiceOrder("en_proceso", "entregada")).toBe(true);
  });

  it("una orden entregada no se reabre", () => {
    expect(canTransitionServiceOrder("entregada", "en_proceso")).toBe(false);
    expect(isTerminalServiceOrderStatus("entregada")).toBe(true);
    expect(isTerminalServiceOrderStatus("cancelada")).toBe(true);
  });

  it("no se salta directo a entregada", () => {
    expect(canTransitionServiceOrder("pendiente", "entregada")).toBe(false);
  });
});

describe("changeQuoteStatus → ciclo comercial", () => {
  const quoteRow = {
    id: "qt_1",
    status: "sent",
    quoteNumber: "COT-0042",
    contactId: "ct_9",
  };

  function quoteWithItem() {
    selectQueue.push(
      [quoteRow],
      [{ productId: null, quantity: 1 }]
    );
  }

  it("al aceptar invoca la conversión en la misma transacción y publica los webhooks", async () => {
    quoteWithItem();

    await changeQuoteStatus("org_1", "qt_1", "accepted", { actorUserId: "usr_1" });

    expect(mocks.acceptQuoteIntoProjectTx).toHaveBeenCalledTimes(1);
    const [dbArg, params] = mocks.acceptQuoteIntoProjectTx.mock.calls[0]!;
    expect(dbArg).toBe(db);
    expect(params).toMatchObject({
      organizationId: "org_1",
      quote: { id: "qt_1", quoteNumber: "COT-0042", contactId: "ct_9" },
      actorUserId: "usr_1",
    });

    const events = mocks.publishWebhook.mock.calls.map((c) => c[1]);
    expect(events).toContain("quote.accepted");
    expect(events).toContain("project.created");
    expect(events).toContain("service_order.created");

    // Calendar es best-effort y se intenta por cada tarea sembrada.
    expect(mocks.syncTaskById).toHaveBeenCalledTimes(2);
    expect(mocks.syncTaskById).toHaveBeenCalledWith("org_1", "prjt_1");
    expect(mocks.syncTaskById).toHaveBeenCalledWith("org_1", "prjt_2");
  });

  it("si la conversión falla, la transacción revierte y NO se publica quote.accepted", async () => {
    quoteWithItem();
    mocks.acceptQuoteIntoProjectTx.mockRejectedValue(new Error("tabla no disponible"));

    await expect(
      changeQuoteStatus("org_1", "qt_1", "accepted")
    ).rejects.toThrow(/tabla no disponible/);

    expect(mocks.publishWebhook).not.toHaveBeenCalled();
    expect(mocks.syncTaskById).not.toHaveBeenCalled();
  });

  it("el fallo de Calendar no tumba la aceptación", async () => {
    quoteWithItem();
    mocks.syncTaskById.mockRejectedValue(new Error("calendar caido"));

    await expect(changeQuoteStatus("org_1", "qt_1", "accepted")).resolves.toBeUndefined();
    expect(mocks.publishWebhook).toHaveBeenCalledWith(
      "org_1",
      "quote.accepted",
      expect.anything()
    );
  });

  it("un rechazo no convierte en proyecto", async () => {
    selectQueue.push([quoteRow]);

    await changeQuoteStatus("org_1", "qt_1", "rejected");

    expect(mocks.acceptQuoteIntoProjectTx).not.toHaveBeenCalled();
    expect(mocks.publishWebhook).toHaveBeenCalledTimes(1);
    expect(mocks.publishWebhook.mock.calls[0]![1]).toBe("quote.rejected");
  });
});

describe("ensureServiceOrderTx (idempotencia)", () => {
  it("ya existe la orden de la cotización ⇒ no duplica", async () => {
    selectQueue.push([{ id: "os_previa" }]);

    const result = await ensureServiceOrderTx(db, {
      organizationId: "org_1",
      projectId: "prj_1",
      quoteId: "qt_1",
      contactId: "ct_1",
      title: "Orden de COT-0042",
    });

    expect(result).toEqual({ id: "os_previa", created: false });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("no existía ⇒ crea la orden con código OS secuencial y evento de bitácora", async () => {
    // 1) ¿existe? → no
    selectQueue.push([]);
    // 2) nextServiceOrderCode → último código
    selectQueue.push([{ code: "OS-0007" }]);

    const result = await ensureServiceOrderTx(db, {
      organizationId: "org_1",
      projectId: "prj_1",
      quoteId: "qt_1",
      contactId: "ct_1",
      title: "Orden de COT-0042",
      createdBy: "usr_1",
    });

    expect(result.created).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1); // advisory lock

    const order = mocks.inserted.find((row) => row.code === "OS-0008");
    expect(order).toBeTruthy();
    expect(order).toMatchObject({
      organizationId: "org_1",
      projectId: "prj_1",
      quoteId: "qt_1",
      status: "pendiente",
    });

    const event = mocks.inserted.find((row) => row.toStatus === "pendiente");
    expect(event).toBeTruthy();
    expect(event).toMatchObject({ serviceOrderId: result.id, actorId: "usr_1" });
  });
});

describe("migración aditiva 0069", () => {
  it("está registrada en el journal y el archivo existe", () => {
    const root = resolve(process.cwd());
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8")
    ) as { entries: { tag: string }[] };
    const entry = journal.entries.find((e) => e.tag === "0069_ciclo_comercial");
    expect(entry).toBeTruthy();
    expect(existsSync(resolve(root, "drizzle/0069_ciclo_comercial.sql"))).toBe(true);
  });

  it("es puramente aditiva: no destruye datos existentes", () => {
    const root = resolve(process.cwd());
    const sql = readFileSync(resolve(root, "drizzle/0069_ciclo_comercial.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
    expect(sql).toContain('"project_quote"');
    expect(sql).toContain('"service_order"');
    expect(sql).toContain('"service_order_event"');
  });
});
