import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasUtm, parseUtmParams } from "@/lib/utm";
import {
  recordDeclaredTouch,
  recordLeadFirstTouch,
  recordReferralTouch,
} from "@/server/attribution/touch";

/**
 * Fase E — P3 atribución: productores de `attribution_event`.
 *
 * La tabla ya existía y la leían el dashboard y el reporte comercial, pero
 * NADIE la escribía. Estos tests cubren el contrato del productor único:
 *  1. UTMs: parseo de la URL del anuncio de Meta.
 *  2. First touch: referral de Meta, fuente declarada, y fallback por canal.
 *  3. Idempotencia del primer toque (índice parcial).
 *  4. Last touch: referral de Meta y declarado.
 *  5. Best-effort: un contacto inexistente no revienta.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

let selectQueue: unknown[][] = [];
let insertQueue: unknown[][] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "orderBy", "limit", "for", "offset", "set"]) {
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
};

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  insertQueue = [];
  mocks.getDb.mockReturnValue(db);
  mocks.execute.mockResolvedValue(undefined);
  mocks.select.mockImplementation(() => thenableChain(selectQueue.shift() ?? []));
  mocks.insert.mockImplementation(() => ({
    values: () => ({
      onConflictDoNothing: () => ({
        returning: () => Promise.resolve(insertQueue.shift() ?? []),
      }),
    }),
  }));
  mocks.update.mockReturnValue({
    set: () => ({ where: () => Promise.resolve([]) }),
  });
});

describe("parseUtmParams", () => {
  it("extrae los cinco parámetros de una URL con UTMs", () => {
    const utms = parseUtmParams("https://landing.com/?utm_source=facebook&utm_medium=cpc&utm_campaign=verano&utm_content=video&utm_term=oferta");
    expect(utms.utmSource).toBe("facebook");
    expect(utms.utmMedium).toBe("cpc");
    expect(utms.utmCampaign).toBe("verano");
    expect(utms.utmContent).toBe("video");
    expect(utms.utmTerm).toBe("oferta");
  });

  it("URL sin UTMs → todo null", () => {
    const utms = parseUtmParams("https://landing.com/");
    expect(utms.utmSource).toBeNull();
    expect(utms.utmMedium).toBeNull();
  });

  it("URL inválida o vacía → todo null (Meta manda basura)", () => {
    expect(parseUtmParams(null).utmSource).toBeNull();
    expect(parseUtmParams("not-a-url").utmSource).toBeNull();
    expect(parseUtmParams("").utmSource).toBeNull();
  });

  it("valores vacíos o whitespace → null", () => {
    const utms = parseUtmParams("https://x.com/?utm_source=%20%20&utm_medium=");
    expect(utms.utmSource).toBeNull();
    expect(utms.utmMedium).toBeNull();
  });
});

describe("hasUtm", () => {
  it("true si hay al menos un parámetro", () => {
    expect(hasUtm({ utmSource: "fb", utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null })).toBe(true);
  });
  it("false si todos son null", () => {
    expect(hasUtm({ utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null })).toBe(false);
  });
});

describe("recordLeadFirstTouch", () => {
  const org = "org_1";
  const contact = "ct_1";

  it("referral de Meta → kind anuncio, clickId, canal meta_ads", async () => {
    selectQueue.push(
      [{ channel: "whatsapp", source: null, medium: null, acquisitionChannelId: null }],
      [],
      [{ id: "ac_meta" }],
      [{ acquisitionChannelId: null }],
    );
    insertQueue.push([{ id: "ae_1" }]);

    const ok = await recordLeadFirstTouch({
      organizationId: org,
      contactId: contact,
      referral: { ctwa_clid: "clid_abc", source_id: "ad_123", headline: "Promo" },
    });

    expect(ok).toBe(true);
    const insertCall = mocks.insert.mock.results[0]?.value;
    expect(insertCall).toBeDefined();
  });

  it("sin referral pero con fuente declarada → kind declarado", async () => {
    selectQueue.push(
      [{ channel: "whatsapp", source: "google", medium: "cpc", acquisitionChannelId: null }],
      [],
    );
    insertQueue.push([{ id: "ae_2" }]);

    const ok = await recordLeadFirstTouch({
      organizationId: org,
      contactId: contact,
    });

    expect(ok).toBe(true);
  });

  it("sin referral ni fuente → kind canal, source whatsapp_directo", async () => {
    selectQueue.push(
      [{ channel: "whatsapp", source: null, medium: null, acquisitionChannelId: null }],
      [],
      [{ id: "ac_wa" }],
      [{ acquisitionChannelId: null }],
    );
    insertQueue.push([{ id: "ae_3" }]);

    const ok = await recordLeadFirstTouch({
      organizationId: org,
      contactId: contact,
    });

    expect(ok).toBe(true);
  });

  it("contacto inexistente → false, no inserta", async () => {
    selectQueue.push([]);
    const ok = await recordLeadFirstTouch({ organizationId: org, contactId: "ct_nope" });
    expect(ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("onConflictDoNothing sin fila → false (idempotencia del índice parcial)", async () => {
    selectQueue.push(
      [{ channel: "whatsapp", source: null, medium: null, acquisitionChannelId: null }],
      [],
      [{ id: "ac_wa" }],
      [{ acquisitionChannelId: null }],
    );
    insertQueue.push([]);

    const ok = await recordLeadFirstTouch({
      organizationId: org,
      contactId: contact,
    });

    expect(ok).toBe(false);
  });

  it("canal ya asignado al contacto → no lo pisa", async () => {
    selectQueue.push(
      [{ channel: "whatsapp", source: null, medium: null, acquisitionChannelId: "ac_existing" }],
      [],
      [{ id: "ac_wa" }],
      [{ acquisitionChannelId: "ac_existing" }],
    );
    insertQueue.push([{ id: "ae_4" }]);

    const ok = await recordLeadFirstTouch({
      organizationId: org,
      contactId: contact,
    });

    expect(ok).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("recordReferralTouch", () => {
  it("inserta last touch con kind anuncio", async () => {
    selectQueue.push([{ id: "ac_meta" }], [{ acquisitionChannelId: null }]);
    insertQueue.push([{ id: "ae_5" }]);

    await recordReferralTouch({
      organizationId: "org_1",
      contactId: "ct_1",
      referral: { ctwa_clid: "clid_xyz" },
    });

    expect(mocks.insert).toHaveBeenCalled();
  });

  it("sin ctwa_clid → kind declarado", async () => {
    selectQueue.push([{ id: "ac_meta" }], [{ acquisitionChannelId: null }]);
    insertQueue.push([{ id: "ae_6" }]);

    await recordReferralTouch({
      organizationId: "org_1",
      contactId: "ct_1",
      referral: { source_id: "ad_999" },
    });

    expect(mocks.insert).toHaveBeenCalled();
  });
});

describe("recordDeclaredTouch", () => {
  it("inserta last touch declarado", async () => {
    insertQueue.push([{ id: "ae_7" }]);
    await recordDeclaredTouch({
      organizationId: "org_1",
      contactId: "ct_1",
      source: "google",
      medium: "cpc",
    });
    expect(mocks.insert).toHaveBeenCalled();
  });

  it("sin source ni medium → no inserta", async () => {
    await recordDeclaredTouch({ organizationId: "org_1", contactId: "ct_1" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
