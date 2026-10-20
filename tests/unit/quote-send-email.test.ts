import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailParticipantOf } from "@/server/email/service";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  sendEmail: vi.fn(),
  quotePdf: vi.fn(),
}));

let selectQueue: unknown[][] = [];

/** Cadena thenable: cualquier método devuelve la misma cadena y el await resuelve las filas. */
function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy", "limit", "for", "leftJoin"]) {
    chain[method] = vi.fn(() => chain);
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

function thenableVoid() {
  const chain: Record<string, unknown> = {};
  for (const method of ["set", "where", "values", "returning"]) chain[method] = vi.fn(() => chain);
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve([]).then(resolve);
  return chain;
}

const tx = {
  select: mocks.select,
  update: mocks.update,
  insert: mocks.insert,
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/webhooks/dispatcher", () => ({ publishWebhook: vi.fn() }));
// El helper de corresponsal se deja REAL: es la lógica que se quiere probar.
vi.mock("@/server/email/service", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/email/service")>(),
  sendEmail: mocks.sendEmail,
}));
vi.mock("@/server/quotes/pdf", () => ({ quotePdf: mocks.quotePdf }));
vi.mock("@/server/documents/pdf", () => ({ money: (cents: number) => `$${(cents / 100).toFixed(2)}` }));

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  mocks.getDb.mockReturnValue({
    ...tx,
    transaction: (work: (t: typeof tx) => Promise<unknown>) => work(tx),
  });
  mocks.select.mockImplementation(() => thenableChain(selectQueue.shift() ?? []));
  mocks.update.mockReturnValue(thenableVoid());
  mocks.insert.mockReturnValue(thenableVoid());
  mocks.sendEmail.mockResolvedValue("<msg-saliente@zorro.tech>");
  mocks.quotePdf.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) });
});

/** Borrador con contacto: así llega una cotización creada desde el cotizador. */
const quoteRow = {
  id: "qt_1",
  organizationId: "org_1",
  quoteNumber: "COT-0007",
  status: "draft",
  total: 58000,
  subtotal: 50000,
  discountAmount: 0,
  taxAmount: 8000,
  currency: "MXN",
  version: 1,
  contactId: "ct_1",
  message: null,
  validUntil: null,
};

const anchorInbound = {
  id: "em_1",
  messageId: "<abc@client>",
  threadId: null,
  direction: "inbound",
  from: "cliente@ejemplo.com",
  to: { value: [{ address: "hola@zorro.tech", name: "Zorro Tech" }] },
  subject: "Presupuesto de cámaras",
  accountId: "ea_1",
};

/**
 * Fila de selects que consume sendQuote por correo: cota, partida, cuenta,
 * hilo, contacto y los tres de getQuote() del resumen. `account`/`anchor` en
 * null simulan que la cuenta o el mensaje no pertenecen al negocio.
 */
function queueEmailRows(opts: {
  quote?: unknown;
  account?: unknown | null;
  anchor?: unknown | null;
  items?: unknown[];
} = {}) {
  const quote = opts.quote ?? quoteRow;
  selectQueue.push(
    [quote],                                      // quote (for update)
    [{ name: "Instalación de cámaras" }],         // primera partida → nombre del archivo
    opts.account === null ? [] : [opts.account ?? { emailAddress: "hola@zorro.tech" }],
    opts.anchor === null ? [] : [opts.anchor ?? anchorInbound],
    [{ name: "Juan Pérez" }],                     // contacto de la cotización
    [quote],                                      // getQuote: quote
    opts.items ?? [],                             // getQuote: items
    [{ name: "Juan Pérez", phone: null, ficha: null }], // getQuote: contacto
  );
}

describe("corresponsal de un hilo de correo", () => {
  it("en un entrante responde a quien escribió, no a la propia cuenta", () => {
    expect(emailParticipantOf(anchorInbound, "hola@zorro.tech")).toEqual({
      email: "cliente@ejemplo.com",
      name: null,
    });
  });

  it("en un saliente salta nuestra dirección y toma el destinatario con nombre", () => {
    const outbound = {
      direction: "outbound",
      from: "hola@zorro.tech",
      to: {
        value: [
          { address: "hola@zorro.tech", name: "Zorro Tech" },
          { address: "ana@ejemplo.com", name: "Ana Ruiz" },
        ],
      },
    };
    expect(emailParticipantOf(outbound, "hola@zorro.tech")).toEqual({
      email: "ana@ejemplo.com",
      name: "Ana Ruiz",
    });
  });

  it("sin destinatarios legibles no inventa una dirección", () => {
    expect(emailParticipantOf({ direction: "outbound", from: "a@b.c", to: null }, "a@b.c")).toEqual({
      email: "",
      name: null,
    });
  });
});

describe("envío de cotizaciones por correo", () => {
  it("adjunta el PDF con el nombre del cliente y responde dentro del hilo", async () => {
    queueEmailRows();
    const { sendQuote } = await import("@/server/quotes/service");

    await sendQuote("org_1", "qt_1", {
      channel: "email",
      emailAccountId: "ea_1",
      emailMessageId: "em_1",
    });

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const [org, account, input] = mocks.sendEmail.mock.calls[0]!;
    expect(org).toBe("org_1");
    expect(account).toBe("ea_1");
    expect(input).toMatchObject({
      // El destinatario sale del hilo, nunca de lo que envió el navegador.
      to: "cliente@ejemplo.com",
      subject: "Re: Presupuesto de cámaras",
      inReplyTo: "<abc@client>",
      contactId: "ct_1",
      attachments: [{ filename: "Cotizacion Instalación de cámaras - Juan Pérez.pdf", contentType: "application/pdf" }],
    });
    expect(String(input.text)).toContain("Cotización COT-0007");
    expect(String(input.text)).toContain("Total: $580.00 MXN");
  });

  it("no agrega «Re:» a un hilo que ya responde", async () => {
    queueEmailRows({ anchor: { ...anchorInbound, subject: "Re: Presupuesto de cámaras" } });
    const { sendQuote } = await import("@/server/quotes/service");

    await sendQuote("org_1", "qt_1", {
      channel: "email",
      emailAccountId: "ea_1",
      emailMessageId: "em_1",
    });
    expect(mocks.sendEmail.mock.calls[0]![2].subject).toBe("Re: Presupuesto de cámaras");
  });

  it("rechaza una cuenta de correo de otro negocio antes de enviar nada", async () => {
    queueEmailRows({ account: null });
    const { sendQuote } = await import("@/server/quotes/service");

    await expect(
      sendQuote("org_1", "qt_1", {
        channel: "email",
        emailAccountId: "ea_otro",
        emailMessageId: "em_1",
      })
    ).rejects.toThrow(/no pertenece a tu negocio/);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("rechaza un mensaje de correo que no es de esa cuenta", async () => {
    queueEmailRows({ anchor: null });
    const { sendQuote } = await import("@/server/quotes/service");

    await expect(
      sendQuote("org_1", "qt_1", {
        channel: "email",
        emailAccountId: "ea_1",
        emailMessageId: "em_de_otro_hilo",
      })
    ).rejects.toThrow(/hilo de correo no existe/);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("un hilo sin corresponsal claro no se envía a medias", async () => {
    queueEmailRows({
      anchor: {
        ...anchorInbound,
        direction: "outbound",
        from: "hola@zorro.tech",
        // Un saliente dirigido sólo a nuestra cuenta no tiene a quién responder.
        to: { value: [{ address: "hola@zorro.tech", name: "Zorro Tech" }] },
      },
    });
    const { sendQuote } = await import("@/server/quotes/service");

    await expect(
      sendQuote("org_1", "qt_1", {
        channel: "email",
        emailAccountId: "ea_1",
        emailMessageId: "em_1",
      })
    ).rejects.toThrow(/no tiene una dirección del cliente/);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("una cotización ya enviada no vuelve a salir por correo", async () => {
    queueEmailRows({ quote: { ...quoteRow, status: "sent" } });
    const { sendQuote } = await import("@/server/quotes/service");

    await expect(
      sendQuote("org_1", "qt_1", {
        channel: "email",
        emailAccountId: "ea_1",
        emailMessageId: "em_1",
      })
    ).rejects.toThrow(/ya no es un borrador/);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
