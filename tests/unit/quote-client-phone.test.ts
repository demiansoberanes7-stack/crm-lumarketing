import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createQuote,
  getQuote,
  normalizeClientPhone,
  updateQuote,
} from "@/server/quotes/service";

/**
 * El teléfono del cliente es un dato de la COTIZACIÓN, no solo del contacto: se
 * cotiza a gente sin ficha y el PDF tiene que imprimir el número que escribió
 * el operador. Aquí se cierra eso y la regla de preferencia
 * (`clientPhone` > `contact.phone`).
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

const QUOTE_ROW = {
  id: "qt_1",
  quoteNumber: "COT-0001",
  status: "draft",
  contactId: "ct_1",
  clientPhone: "55 1111 2222",
  subtotal: 100,
  discountType: null,
  discountValue: null,
  taxRate: 16,
  taxAmount: 16,
  total: 116,
  discountAmount: 0,
  paymentMethod: null,
  validUntil: null,
  message: null,
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

describe("normalizeClientPhone", () => {
  it("deja lo marcable: dígitos, +, guion, punto y espacios", () => {
    expect(normalizeClientPhone("+52 (55) 1234-5678")).toBe("+52 55 1234-5678");
    expect(normalizeClientPhone("  55.1234.5678  ")).toBe("55.1234.5678");
  });

  it("descarta lo que no es un teléfono", () => {
    expect(normalizeClientPhone("llámame luego")).toBeNull();
    expect(normalizeClientPhone("12345")).toBeNull();
    expect(normalizeClientPhone(null)).toBeNull();
    expect(normalizeClientPhone(undefined)).toBeNull();
  });

  it("cabe en la columna", () => {
    expect(normalizeClientPhone("1".repeat(80))?.length).toBe(32);
  });
});

describe("createQuote con teléfono", () => {
  it("guarda el teléfono normalizado de la cotización", async () => {
    selectQueue.push([], [{ quoteNumber: "COT-0001" }]);
    await createQuote("org_1", {
      items: [{ name: "iPhone", quantity: 1, unitPrice: 100 }],
      clientPhone: "(55) 1234 5678",
    });
    const values = inserted.find((v) => v.quoteNumber !== undefined);
    expect(values?.clientPhone).toBe("55 1234 5678");
  });

  it("sin teléfono no inventa nada: columna null", async () => {
    selectQueue.push([], [{ quoteNumber: "COT-0002" }]);
    await createQuote("org_1", {
      items: [{ name: "iPhone", quantity: 1, unitPrice: 100 }],
    });
    const values = inserted.find((v) => v.quoteNumber !== undefined);
    expect(values?.clientPhone).toBeNull();
  });
});

describe("getQuote: de quién se imprime el número", () => {
  it("manda el de la cotización sobre el del contacto", async () => {
    selectQueue.push(
      [{ ...QUOTE_ROW, clientPhone: "55 1111 2222" }],
      [],
      [{ name: "Ana", phone: "55 9999 8888", ficha: null }]
    );
    const quote = await getQuote("org_1", "qt_1");
    expect(quote?.contactPhone).toBe("55 1111 2222");
  });

  it("si la cotización no lo tiene, usa el del contacto", async () => {
    selectQueue.push(
      [{ ...QUOTE_ROW, clientPhone: null }],
      [],
      [{ name: "Ana", phone: "55 9999 8888", ficha: null }]
    );
    const quote = await getQuote("org_1", "qt_1");
    expect(quote?.contactPhone).toBe("55 9999 8888");
  });
});

describe("updateQuote con teléfono", () => {
  it("lo cambia cuando el operador lo edita", async () => {
    selectQueue.push([{ ...QUOTE_ROW }], [{ ...QUOTE_ROW }], [], []);
    await updateQuote("org_1", "qt_1", { clientPhone: "442 111 2233" });
    expect(updated.at(-1)?.clientPhone).toBe("442 111 2233");
  });

  it("lo conserva cuando el PATCH no habla del teléfono", async () => {
    selectQueue.push([{ ...QUOTE_ROW }], [{ ...QUOTE_ROW }], [], []);
    await updateQuote("org_1", "qt_1", { notes: "otra cosa" });
    expect(updated.at(-1)?.clientPhone).toBe("55 1111 2222");
  });
});
