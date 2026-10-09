import type {
  campaign,
  serviceCost,
  marketplaceOrder,
} from "@/lib/db/schema";

type Campaign = typeof campaign.$inferSelect;
type ServiceCost = typeof serviceCost.$inferSelect;
type MarketplaceOrder = typeof marketplaceOrder.$inferSelect;

export function serializeCampaign(row: Campaign) {
  return {
    id: row.id,
    platform: row.platform,
    name: row.name,
    externalId: row.externalId,
    objective: row.objective,
    status: row.status,
    currency: row.currency,
    budgetPlannedCents: row.budgetPlannedCents,
    startDate: row.startDate?.toISOString() ?? null,
    endDate: row.endDate?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeServiceCost(row: ServiceCost) {
  return {
    id: row.id,
    catalogProductId: row.catalogProductId,
    service: row.service,
    name: row.name,
    costCents: row.costCents,
    currency: row.currency,
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeMarketplaceOrder(row: MarketplaceOrder) {
  return {
    id: row.id,
    platform: row.platform,
    externalId: row.externalId,
    orderNumber: row.orderNumber,
    contactId: row.contactId,
    itemName: row.itemName,
    quantity: row.quantity,
    amountCents: row.amountCents,
    commissionCents: row.commissionCents,
    currency: row.currency,
    status: row.status,
    orderedAt: row.orderedAt.toISOString(),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
