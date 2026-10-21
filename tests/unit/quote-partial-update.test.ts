import { beforeEach, describe, expect, it, vi } from "vitest";
import { listQuotes, updateQuote } from "@/server/quotes/service";

/**
 * Un parche parcial NO es una orden de borrar.
 *
 * El handler de MCP (`mcp/actions/quotes.ts`) construye todas las claves del
 * `Partial<QuoteInput>` aunque el llamador solo cambie las notas, así que
 * `taxRate: undefined` llegaba a `updateQuote` y el 16 % volvía a imponerse
 * sobre una cotización pedida «sin IVA» —la regla explícita del dueño—. El
 * contacto, el descuento y las partidas se iban igual a `null`.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  publishWebhook: vi.fn(),
}));

let selectQueue: unknown[][] = [];
const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "orderBy", "limit", "for", "offset"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.where = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
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

const ITEM = {
  id: "qi_1",
  quoteId: "qt_1",
  productId: null,
  name: "iPhone 15",
  description: null,
  quantity: 1,
  unitPrice: 10000,
  position: 0,
};

/** Cotización pedida SIN IVA y con descuento del 10 %. */
const SIN_IVA = {
  id: "qt_1",
  quoteNumber: "COT-0004",
  status: "draft",
  contactId: "ct_1",
  clientPhone: "55 1111 2222",
  subtotal: 11111,
  discountType: "percentage",
  discountValue: 10,
  discountAmount: 1111,
  taxRate: 0,
  taxAmount: 0,
  total: 10000,
  paymentMethod: { conditions: "50 % al firmar" },
  validUntil: null,
  message: "nota antigua",
};

function queueForUpdate() {
  // 1 SELECT ... FOR UPDATE · 2 getQuote(quote) · 3 getQuote(items) · 4 getQuote(contact)
  selectQueue.push(
    [SIN_IVA],
    [SIN_IVA],
    [{ item: ITEM, longDescription: null }],
    [{ name: "Ana", phone: "55 9999 8888", ficha: null }]
  );
}

/** Lo que manda el agente/MCP cuando solo quiere cambiar las notas. */
const PATCH_SOLO_NOTAS = {
  contactId: undefined,
  items: undefined,
  discountType: undefined,
  discountValue: undefined,
  taxRate: undefined,
  validDays: undefined,
  paymentMethod: undefined,
  paymentConditions: undefined,
  notes: "revisar la entrega",
};

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  inserted.length = 0;
  updated.length = 0;
  mocks.getDb.mockReturnValue(db);
  mocks.execute.mockResolvedValue(undefined);
  mocks.select.mockImplementation(() => thenableChain(selectQueue.shift() ?? []));
  mocks.insert.mockReturnValue({
    values: (v: Record<string, unknown>) => {
      inserted.push(v);
      return Promise.resolve([]);
    },
  });
  mocks.update.mockReturnValue({
    set: (patch: Record<string, unknown>) => {
      updated.push(patch);
      return { where: () => Promise.resolve([]) };
    },
  });
  mocks.delete.mockReturnValue({ where: () => Promise.resolve([]) });
});

describe("updateQuote con un parche que manda claves undefined", () => {
  it("respeta el IVA a cero pedido por el cliente", async () => {
    queueForUpdate();
    await updateQuote("org_1", "qt_1", PATCH_SOLO_NOTAS);
    const patch = updated.at(-1)!;
    expect(patch.taxRate).toBe(0);
    expect(patch.taxAmount).toBe(0);
  });

  it("no reinfla el total con el 16 %", async () => {
    queueForUpdate();
    await updateQuote("org_1", "qt_1", PATCH_SOLO_NOTAS);
    // Partida 10000 − 10 % de descuento = 9000, sin impuesto. Con el bug era
    // 9000 + 16 % = 10440.
    expect(updated.at(-1)!.total).toBe(9000);
    expect(updated.at(-1)!.taxAmount).toBe(0);
  });

  it("conserva contacto, descuento y partidas", async () => {
    queueForUpdate();
    await updateQuote("org_1", "qt_1", PATCH_SOLO_NOTAS);
    const patch = updated.at(-1)!;
    expect(patch.contactId).toBe("ct_1");
    expect(patch.discountType).toBe("percentage");
    expect(patch.discountValue).toBe(10);
    expect(inserted.at(-1)).toMatchObject({ quoteId: "qt_1", name: "iPhone 15", quantity: 1 });
  });

  it("sí borra cuando el null es explícito", async () => {
    queueForUpdate();
    await updateQuote("org_1", "qt_1", { discountType: null, discountValue: null });
    const patch = updated.at(-1)!;
    expect(patch.discountType).toBeNull();
    expect(patch.discountValue).toBeNull();
  });

  it("quitar solo el tipo de descuento no deja el importe huérfano", async () => {
    queueForUpdate();
    // El llamador quita el descuento (`discountType: null`) sin mandar el
    // importe: antes de `discountPair` el 10 % del respaldo se guardaba suelto,
    // no aplicaba en los totales, y el editor lo volvía a rellenar solo.
    await updateQuote("org_1", "qt_1", { discountType: null });
    const patch = updated.at(-1)!;
    expect(patch.discountType).toBeNull();
    expect(patch.discountValue).toBeNull();
    expect(patch.discountAmount).toBe(0);
  });

  it("vaciar las notas las vacía de verdad", async () => {
    queueForUpdate();
    await updateQuote("org_1", "qt_1", { notes: "" });
    expect(updated.at(-1)!.message).toBe("");
  });

  it("vaciar las condiciones de pago las borra del PDF", async () => {
    queueForUpdate();
    await updateQuote("org_1", "qt_1", { paymentConditions: "" });
    expect((updated.at(-1)!.paymentMethod as Record<string, unknown>).conditions).toBe("");
  });
});

describe("listQuotes: a quién se le cotizó", () => {
  it("devuelve el nombre del contacto en la lista", async () => {
    // 1 filas de cotización · 2 nombres de contactos del tenant
    selectQueue.push([SIN_IVA], [{ id: "ct_1", name: "Ana López" }]);
    const rows = await listQuotes("org_1", {});
    expect(rows[0]!.contactName).toBe("Ana López");
  });

  it("dice null cuando la cotización no tiene contacto", async () => {
    selectQueue.push([{ ...SIN_IVA, contactId: null }]);
    const rows = await listQuotes("org_1", {});
    expect(rows[0]!.contactName).toBeNull();
    // Sin contactos que buscar, no se consulta la ficha de nadie.
    expect(selectQueue).toHaveLength(0);
  });
});
