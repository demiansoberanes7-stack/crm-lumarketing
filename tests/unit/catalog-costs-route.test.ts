import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La ruta de recetas de costo, de fuera hacia adentro.
 *
 * Lo que un cliente puede torcer:
 *
 *  1. El negocio NUNCA viene del cuerpo ni de la URL: lo pone la sesión. Un
 *     `organizationId` escrito a mano sería la forma más corta de pintar la
 *     receta de otro.
 *  2. Lo que la `CHECK` de 0090 rechazaría (cantidad 0, unidades absurdos) tiene
 *     que salir 422 aquí, no convertirse en un 500 del INSERT.
 *  3. `{ lines: [] }` es una orden legítima: «este producto ya no tiene receta».
 *  4. El cuerpo habla en centavos; la pantalla hace la conversión una sola vez.
 */

const mocks = vi.hoisted(() => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireSession: vi.fn(),
    getProductCosts: vi.fn(),
    replaceProductCosts: vi.fn(),
  };
});

vi.mock("@/lib/auth/session", () => ({
  requireSession: mocks.requireSession,
  UnauthorizedError: mocks.UnauthorizedError,
}));
vi.mock("@/server/catalog/costs", () => ({
  getProductCosts: mocks.getProductCosts,
  replaceProductCosts: mocks.replaceProductCosts,
}));

import { GET, PUT } from "@/app/api/catalog/[id]/costs/route";

const PRODUCT = "cat_1";
const ctx = () => ({ params: Promise.resolve({ id: PRODUCT }) }) as never;

const costView = (over: Record<string, unknown> = {}) => ({
  lines: [
    {
      id: "pcst_1",
      name: "Cera de soya",
      quantity: 0.3,
      unit: "kg",
      unitPriceCents: 80_000,
      costCents: 24_000,
      mixPct: null,
      costPct: 100,
    },
  ],
  totals: {
    lineCount: 1,
    totalCostCents: 24_000,
    priceCents: 50_000,
    marginCents: 26_000,
    marginPct: 52,
    mixComparable: false,
    units: ["kg"],
    totalQuantity: 0.3,
  },
  ...over,
});

function loginAs(organizationId = "org_zorro") {
  mocks.requireSession.mockResolvedValue({ userId: "user_1", organizationId, role: "owner" });
}

const body = (payload: unknown) =>
  new Request(`http://local/api/catalog/${PRODUCT}/costs`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

const errOf = (payload: unknown) =>
  (payload as { error: { code: string; message: string } }).error;

/** La primera línea del payload enviado a `replaceProductCosts`. */
function sentLines(): Record<string, unknown>[] {
  const arg = mocks.replaceProductCosts.mock.calls[0]![0] as {
    lines: Record<string, unknown>[];
  };
  return arg.lines;
}

beforeEach(() => {
  vi.clearAllMocks();
  loginAs();
});

describe("GET /api/catalog/[id]/costs", () => {
  it("devuelve líneas, totales y costo plano con el negocio de la sesión", async () => {
    mocks.getProductCosts.mockResolvedValue({
      ok: true,
      product: { id: PRODUCT, name: "Vela grande", priceCents: 50_000 },
      cost: costView(),
      flatCostCents: 21_000,
    });
    const res = await GET(new Request("http://local/x"), ctx());
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.product).toEqual({ id: PRODUCT, name: "Vela grande", priceCents: 50_000 });
    expect(json.totals).toEqual(costView().totals);
    expect(json.flatCostCents).toBe(21_000);
    expect(mocks.getProductCosts).toHaveBeenCalledWith("org_zorro", PRODUCT);
  });

  it("un producto que no existe o no es mío sale 404", async () => {
    mocks.getProductCosts.mockResolvedValue({
      ok: false,
      code: "not_found",
      message: "Producto no encontrado",
    });
    const res = await GET(new Request("http://local/x"), ctx());
    expect(res.status).toBe(404);
    expect(errOf(await res.json()).code).toBe("not_found");
  });

  it("sin sesión no se toca el servicio", async () => {
    mocks.requireSession.mockRejectedValue(new mocks.UnauthorizedError());
    const res = await GET(new Request("http://local/x"), ctx());
    expect(res.status).toBe(401);
    expect(mocks.getProductCosts).not.toHaveBeenCalled();
  });
});

describe("PUT /api/catalog/[id]/costs", () => {
  const legit = {
    lines: [{ name: "Cera de soya", quantity: 0.3, unit: "kg", unitPriceCents: 80_000 }],
  };

  it("guarda con el negocio de la sesión, no con el del cuerpo", async () => {
    mocks.replaceProductCosts.mockResolvedValue({ ok: true, cost: costView(), flatCostCents: null });
    const res = await PUT(
      body({ ...legit, organizationId: "org_ajena", productId: "cat_otro" }),
      ctx()
    );
    expect(res.status).toBe(200);
    const arg = mocks.replaceProductCosts.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.organizationId).toBe("org_zorro");
    expect(arg.productId).toBe(PRODUCT);
    expect(JSON.stringify(arg)).not.toContain("org_ajena");
  });

  it("responde lo derivado por el servicio, no un eco del request", async () => {
    mocks.replaceProductCosts.mockResolvedValue({
      ok: true,
      cost: costView({ totals: { ...costView().totals, totalCostCents: 40_000 } }),
      flatCostCents: 21_000,
    });
    const res = await PUT(body(legit), ctx());
    const json = (await res.json()) as { totals: { totalCostCents: number } };
    expect(json.totals.totalCostCents).toBe(40_000);
  });

  it("lines: [] es válido y llega vacío al servicio", async () => {
    mocks.replaceProductCosts.mockResolvedValue({ ok: true, cost: costView({ lines: [] }), flatCostCents: null });
    const res = await PUT(body({ lines: [] }), ctx());
    expect(res.status).toBe(200);
    expect(sentLines()).toEqual([]);
  });

  it("cantidad 0 se rechaza antes de que la CHECK devuelva un 500", async () => {
    const res = await PUT(body({ lines: [{ ...legit.lines[0], quantity: 0 }] }), ctx());
    expect(res.status).toBe(422);
    expect(mocks.replaceProductCosts).not.toHaveBeenCalled();
  });

  it("cantidad negativa, NaN o infinita tampoco pasan", async () => {
    for (const quantity of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      vi.clearAllMocks();
      loginAs();
      const res = await PUT(body({ lines: [{ ...legit.lines[0], quantity }] }), ctx());
      expect(res.status).toBe(422);
    }
    expect(mocks.replaceProductCosts).not.toHaveBeenCalled();
  });

  it("nombre vacío o unidad vacía: 422", async () => {
    expect((await PUT(body({ lines: [{ ...legit.lines[0], name: "" }] }), ctx())).status).toBe(422);
    expect((await PUT(body({ lines: [{ ...legit.lines[0], unit: "  " }] }), ctx())).status).toBe(422);
    expect(mocks.replaceProductCosts).not.toHaveBeenCalled();
  });

  it("el costo por unidad se escribe en centavos: fracciones y negativos fuera", async () => {
    for (const unitPriceCents of [10.5, -1, 100_000_001]) {
      vi.clearAllMocks();
      loginAs();
      const res = await PUT(body({ lines: [{ ...legit.lines[0], unitPriceCents }] }), ctx());
      expect(res.status).toBe(422);
    }
    expect(mocks.replaceProductCosts).not.toHaveBeenCalled();
  });

  it("una receta de 61 insumos se rechaza, una de 60 entra", async () => {
    const mk = (n: number) => ({
      lines: Array.from({ length: n }, (_, i) => ({ ...legit.lines[0], name: `i${i}` })),
    });
    expect((await PUT(body(mk(61)), ctx())).status).toBe(422);
    expect(mocks.replaceProductCosts).not.toHaveBeenCalled();

    vi.clearAllMocks();
    loginAs();
    mocks.replaceProductCosts.mockResolvedValue({ ok: true, cost: costView(), flatCostCents: null });
    expect((await PUT(body(mk(60)), ctx())).status).toBe(200);
    expect(sentLines()).toHaveLength(60);
  });

  it("la cantidad por encima del techo de la CHECK no se acepta", async () => {
    const res = await PUT(body({ lines: [{ ...legit.lines[0], quantity: 1_000_001 }] }), ctx());
    expect(res.status).toBe(422);
  });

  it("un cuerpo sin lines, roto, o con una línea que no es objeto: 422", async () => {
    expect((await PUT(body({}), ctx())).status).toBe(422);
    expect((await PUT(body({ lines: "cera" }), ctx())).status).toBe(422);
    expect((await PUT(body({ lines: [42] }), ctx())).status).toBe(422);
    expect(
      (
        await PUT(
          new Request(`http://local/api/catalog/${PRODUCT}/costs`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: "{",
          }),
          ctx()
        )
      ).status
    ).toBe(422);
    expect(mocks.replaceProductCosts).not.toHaveBeenCalled();
  });

  it("el producto de otro negocio sale 404, no un ok", async () => {
    mocks.replaceProductCosts.mockResolvedValue({
      ok: false,
      code: "not_found",
      message: "Producto no encontrado",
    });
    const res = await PUT(body(legit), ctx());
    expect(res.status).toBe(404);
  });

  it("la id que envía el cliente se tolera, aunque el reemplazo la ignora", async () => {
    mocks.replaceProductCosts.mockResolvedValue({ ok: true, cost: costView(), flatCostCents: null });
    const res = await PUT(body({ lines: [{ ...legit.lines[0], id: "pcst_vieja" }] }), ctx());
    expect(res.status).toBe(200);
    expect(sentLines()[0]).toMatchObject({ name: "Cera de soya" });
  });

  it("sin sesión no se escribe nada", async () => {
    mocks.requireSession.mockRejectedValue(new mocks.UnauthorizedError());
    const res = await PUT(body(legit), ctx());
    expect(res.status).toBe(401);
    expect(mocks.replaceProductCosts).not.toHaveBeenCalled();
  });
});
