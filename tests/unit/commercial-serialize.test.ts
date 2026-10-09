import { describe, it, expect } from "vitest";
import {
  serializeCampaign,
  serializeServiceCost,
  serializeMarketplaceOrder,
} from "@/server/commercial/serialize";

const baseRow = {
  organizationId: "org_1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

describe("serializers comerciales", () => {
  it("campaign serializa fechas ISO y centavos tal cual", () => {
    const out = serializeCampaign({
      ...baseRow,
      id: "cmp_1",
      platform: "meta",
      name: "Verano",
      externalId: null,
      objective: "Ventas",
      status: "active",
      currency: "MXN",
      budgetPlannedCents: 500000,
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: null,
    } as never);
    expect(out.id).toBe("cmp_1");
    expect(out.budgetPlannedCents).toBe(500000);
    expect(out.startDate).toBe("2026-01-01T00:00:00.000Z");
    expect(out.endDate).toBeNull();
    expect(out.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("serviceCost serializa centavos y fechas opcionales", () => {
    const out = serializeServiceCost({
      ...baseRow,
      id: "scst_1",
      catalogProductId: null,
      service: "Diseño",
      name: "Impresión",
      costCents: 120000,
      currency: "MXN",
      effectiveFrom: null,
      effectiveTo: null,
      notes: null,
    } as never);
    expect(out.costCents).toBe(120000);
    expect(out.effectiveFrom).toBeNull();
  });

  it("marketplaceOrder serializa monto y comisión en centavos", () => {
    const out = serializeMarketplaceOrder({
      ...baseRow,
      id: "mo_1",
      platform: "mercado_libre",
      externalId: null,
      orderNumber: "123",
      contactId: null,
      itemName: "Playera",
      quantity: 2,
      amountCents: 179800,
      commissionCents: 9000,
      currency: "MXN",
      status: "completed",
      orderedAt: new Date("2026-01-01T00:00:00Z"),
      notes: null,
    } as never);
    expect(out.amountCents).toBe(179800);
    expect(out.commissionCents).toBe(9000);
    expect(out.orderedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
