import { and, count, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { dashboardRange } from "@/server/dashboard/metrics";
import {
  available,
  unavailable,
  averageTicket,
  cac,
  contribution,
  contributionMargin,
  conversionRate,
  roas,
  romi,
  winRate,
  type MetricValue,
} from "@/server/metrics/compute";
import { normalizeLossReason, LOSS_REASON_KEY_LABELS } from "@/lib/loss-reason";

export type CommercialFilters = {
  period: string;
  /** Canal de adquisición (id de acquisition_channel); vacío = todos. */
  channelId?: string | null;
  /** Campaña (id); vacía = todas. */
  campaignId?: string | null;
  /** Servicio; vacío = todos. */
  service?: string | null;
};

/** Envuelve un número en un MetricValue "disponible". */
const num = (value: number, fmt?: (n: number) => string): MetricValue =>
  available(value, fmt);

/** Envuelve un número anulable: null → "no disponible" con el estado dado. */
const maybe = (
  value: number | null,
  state: "no_data" | "not_applicable" = "no_data",
  fmt?: (n: number) => string
): MetricValue => (value == null ? unavailable(state) : available(value, fmt));

type Row = Record<string, unknown>;
const n = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * Plataforma de control comercial: agrega las 10 categorías desde datos REALES
 * del CRM (etapas, cotizaciones, pagos, gastos) y desde las tablas nuevas
 * (campañas, atribución, experimentos, costos). Cada métrica lleva su
 * disponibilidad: si falta la fuente, se marca "no disponible" — jamás un 0.
 */
export async function queryCommercial(
  orgId: string,
  filters: CommercialFilters
) {
  const db = getDb();
  const { from, to, label } = dashboardRange(filters.period);

  const orgScope = (organizationColumn: PgColumn) => scoped(organizationColumn, orgId);

  // ── Ventas / embudo desde la bitácora de etapas ──
  const [createdRow, wonRow, lostRow, quotesSentRow, quotesApprovedRow, paymentsRow, expensesRow] =
    await Promise.all([
      // Leads creados en el periodo (evento de nacimiento = fromStageId null)
      db
        .select({ value: count() })
        .from(schema.leadStageEvent)
        .where(
          and(
            orgScope(schema.leadStageEvent.organizationId),
            isNull(schema.leadStageEvent.fromStageId),
            gte(schema.leadStageEvent.occurredAt, from),
            lte(schema.leadStageEvent.occurredAt, to)
          )
        ),
      db
        .select({ value: count() })
        .from(schema.leadStageEvent)
        .where(
          and(
            orgScope(schema.leadStageEvent.organizationId),
            eq(schema.leadStageEvent.toStageKind, "won"),
            gte(schema.leadStageEvent.occurredAt, from),
            lte(schema.leadStageEvent.occurredAt, to)
          )
        ),
      db
        .select({ value: count() })
        .from(schema.leadStageEvent)
        .where(
          and(
            orgScope(schema.leadStageEvent.organizationId),
            eq(schema.leadStageEvent.toStageKind, "lost"),
            gte(schema.leadStageEvent.occurredAt, from),
            lte(schema.leadStageEvent.occurredAt, to)
          )
        ),
      db
        .select({ value: count() })
        .from(schema.quote)
        .where(
          and(
            orgScope(schema.quote.organizationId),
            inArray(schema.quote.status, ["sent", "accepted", "rejected", "expired"]),
            gte(schema.quote.createdAt, from),
            lte(schema.quote.createdAt, to)
          )
        ),
      db
        .select({ value: count() })
        .from(schema.quote)
        .where(
          and(
            orgScope(schema.quote.organizationId),
            eq(schema.quote.status, "accepted"),
            gte(schema.quote.createdAt, from),
            lte(schema.quote.createdAt, to)
          )
        ),
      db
        .select({ total: sql<number>`coalesce(sum(${schema.payment.monto}), 0)`, cnt: count() })
        .from(schema.payment)
        .where(and(orgScope(schema.payment.organizationId), gte(schema.payment.fecha, from), lte(schema.payment.fecha, to))),
      db
        .select({ total: sql<number>`coalesce(sum(${schema.expense.monto}), 0)` })
        .from(schema.expense)
        .where(and(orgScope(schema.expense.organizationId), gte(schema.expense.fecha, from), lte(schema.expense.fecha, to))),
    ]);

  const newLeads = n(createdRow[0]?.value);
  const won = n(wonRow[0]?.value);
  const lost = n(lostRow[0]?.value);
  const quotesSent = n(quotesSentRow[0]?.value);
  const quotesApproved = n(quotesApprovedRow[0]?.value);
  const revenue = n(paymentsRow[0]?.total);
  const paymentsCount = n(paymentsRow[0]?.cnt);
  const expenses = n(expensesRow[0]?.total);

  // ── Inversión publicitaria (tabla campaign) ──
  const campaignRows = await db
    .select({ spend: sql<number>`coalesce(sum(${schema.campaign.budgetPlannedCents}), 0)` })
    .from(schema.campaign)
    .where(and(orgScope(schema.campaign.organizationId), gte(schema.campaign.createdAt, from), lte(schema.campaign.createdAt, to)));
  const adSpend = campaignRows.reduce((sum, r) => sum + n(r.spend), 0);
  const hasCampaigns = campaignRows.length > 0;

  // ── Atribución: primer toque por canal ──
  const channelRows = (await db
    .select({
      name: schema.acquisitionChannel.name,
      kind: schema.acquisitionChannel.kind,
      cnt: count(),
    })
    .from(schema.attributionEvent)
    .leftJoin(schema.acquisitionChannel, eq(schema.acquisitionChannel.id, schema.attributionEvent.channelId))
    .where(
      and(
        orgScope(schema.attributionEvent.organizationId),
        eq(schema.attributionEvent.touchType, "first"),
        gte(schema.attributionEvent.occurredAt, from),
        lte(schema.attributionEvent.occurredAt, to)
      )
    )
    .groupBy(schema.acquisitionChannel.name, schema.acquisitionChannel.kind)
    .orderBy(sql`count(*) desc`)) as Row[];
  const hasAttribution = channelRows.length > 0;

  // ── Rentabilidad: costo de prestación ──
  const costRows = await db
    .select({ cost: schema.serviceCost.costCents, service: schema.serviceCost.service })
    .from(schema.serviceCost)
    .where(orgScope(schema.serviceCost.organizationId));
  const hasCosts = costRows.length > 0;
  const totalDeliveryCost = costRows.reduce((sum, r) => sum + n(r.cost), 0);
  const contrib = hasCosts ? contribution(revenue, totalDeliveryCost, hasCampaigns ? adSpend : 0) : null;

  // ── Experimentos ──
  const experimentRows = await db
    .select({
      id: schema.experiment.id,
      name: schema.experiment.name,
      status: schema.experiment.status,
      evidenceStatus: schema.experiment.evidenceStatus,
      primaryMetric: schema.experiment.primaryMetric,
    })
    .from(schema.experiment)
    .where(orgScope(schema.experiment.organizationId));

  // ── Operaciones: tiempo de respuesta (actividad entrante→saliente) ──
  const activityRows = await db
    .select({ occurredAt: schema.activityEvent.occurredAt, type: schema.activityEvent.type, direction: schema.activityEvent.direction })
    .from(schema.activityEvent)
    .where(and(orgScope(schema.activityEvent.organizationId), gte(schema.activityEvent.occurredAt, from), lte(schema.activityEvent.occurredAt, to)))
    .orderBy(schema.activityEvent.occurredAt)
    .limit(2000);
  const hasActivities = activityRows.length > 0;

  // ── Marketplace (ventas ML manuales) ──
  const mlRows = await db
    .select({ amount: sql<number>`coalesce(sum(${schema.marketplaceOrder.amountCents}), 0)`, cnt: count() })
    .from(schema.marketplaceOrder)
    .where(and(orgScope(schema.marketplaceOrder.organizationId), gte(schema.marketplaceOrder.orderedAt, from), lte(schema.marketplaceOrder.orderedAt, to)));
  const mlRevenue = n(mlRows[0]?.amount);
  const mlCount = n(mlRows[0]?.cnt);

  // ── Calidad de datos: contactos con canal capturado ──
  const [contactsRow, withChannelRow] = await Promise.all([
    db.select({ value: count() }).from(schema.contact).where(and(orgScope(schema.contact.organizationId), isNull(schema.contact.archivedAt))),
    db
      .select({ value: count() })
      .from(schema.contact)
      .where(and(orgScope(schema.contact.organizationId), isNull(schema.contact.archivedAt), sql`${schema.contact.acquisitionChannelId} is not null`)),
  ]);
  const totalContacts = n(contactsRow[0]?.value);
  const contactsWithChannel = n(withChannelRow[0]?.value);

  // ── Motivos de pérdida (normalizados) ──
  const lossRows = (await db
    .select({ reason: schema.leadStageEvent.lossReason, cnt: count() })
    .from(schema.leadStageEvent)
    .where(
      and(
        orgScope(schema.leadStageEvent.organizationId),
        eq(schema.leadStageEvent.toStageKind, "lost"),
        gte(schema.leadStageEvent.occurredAt, from),
        lte(schema.leadStageEvent.occurredAt, to)
      )
    )
    .groupBy(schema.leadStageEvent.lossReason)) as Row[];
  const lossByReason = new Map<string, number>();
  for (const r of lossRows) {
    const key = normalizeLossReason(r.reason as string | null);
    lossByReason.set(key, (lossByReason.get(key) ?? 0) + n(r.cnt));
  }

  // ── Armado de categorías con disponibilidad explícita ──
  return {
    period: label,
    range: { from: from.toISOString(), to: to.toISOString(), timezone: "UTC" },
    currency: "MXN",

    resumen: {
      revenue: num(revenue),
      netIncome: num(revenue - expenses),
      newLeads: num(newLeads),
      closedDeals: num(won),
      avgTicket: maybe(averageTicket(revenue, paymentsCount)),
      winRate: maybe(winRate(won, lost)),
    },

    ventas: {
      closedDeals: num(won),
      lostDeals: num(lost),
      revenue: num(revenue),
      avgTicket: maybe(averageTicket(revenue, paymentsCount)),
      winRate: maybe(winRate(won, lost)),
      quotesSent: num(quotesSent),
      quotesApproved: num(quotesApproved),
      quoteApprovalRate: maybe(conversionRate(quotesApproved, quotesSent)),
    },

    embudo: {
      stages: [
        { stage: "Prospectos", value: newLeads },
        { stage: "Ganados", value: won },
        { stage: "Perdidos", value: lost },
      ],
      leadToWon: maybe(conversionRate(won, newLeads)),
      leadToQuote: maybe(conversionRate(quotesSent, newLeads)),
      quoteToWon: maybe(conversionRate(won, quotesSent)),
      lossByReason: [...lossByReason].map(([key, value]) => ({
        key,
        label: LOSS_REASON_KEY_LABELS[key as keyof typeof LOSS_REASON_KEY_LABELS] ?? key,
        value,
      })),
    },

    publicidad: {
      adSpend: hasCampaigns ? num(adSpend) : unavailable("no_data"),
      roas: hasCampaigns ? maybe(roas(revenue, adSpend), "not_applicable") : unavailable("no_data"),
      romi: hasCampaigns ? maybe(romi(revenue, adSpend), "not_applicable") : unavailable("no_data"),
      cac: hasCampaigns ? maybe(cac(adSpend, won), "not_applicable") : unavailable("no_data"),
    },

    // La capa de tráfico (GA4) se mezcla en la ruta: aquí solo el vínculo
    // sesión→prospecto cuando ya hay sesiones.
    trafico: {
      sessionToLead: unavailable("pending"),
    },

    adquisicion: {
      byChannel: hasAttribution
        ? channelRows.map((r) => ({ name: (r.name as string) ?? "Sin canal", kind: (r.kind as string) ?? "unknown", count: n(r.cnt) }))
        : [],
      hasData: hasAttribution,
    },

    rentabilidad: {
      contribution: contrib == null ? unavailable("no_data") : num(contrib),
      contributionMargin: maybe(contributionMargin(contrib, revenue), "no_data"),
      hasCosts,
      mlRevenue: mlCount > 0 ? num(mlRevenue) : unavailable("no_data"),
      mlOrders: num(mlCount),
    },

    experimentos: {
      items: experimentRows.map((e) => ({
        id: e.id as string,
        name: e.name as string,
        status: e.status as string,
        evidenceStatus: e.evidenceStatus as string,
        primaryMetric: (e.primaryMetric as string) ?? null,
      })),
      total: experimentRows.length,
    },

    operaciones: {
      responseTimeHours: unavailable(hasActivities ? "no_data" : "pending"),
      activitiesLogged: num(activityRows.length),
    },

    calidad: {
      contactsWithChannel: maybe(conversionRate(contactsWithChannel, totalContacts), "no_data"),
      totalContacts: num(totalContacts),
      contactsWithChannelCount: num(contactsWithChannel),
    },
  } as const;
}

export type CommercialData = Awaited<ReturnType<typeof queryCommercial>>;
