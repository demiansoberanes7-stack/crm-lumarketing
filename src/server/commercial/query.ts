import { and, count, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { dashboardRange } from "@/server/dashboard/metrics";
import {
  available,
  unavailable,
  averageTicket,
  contribution,
  contributionMargin,
  conversionRate,
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
/**
 * Normaliza un valor numérico viniendo de Postgres. `sum()` regresa bigint y
 * postgres-js lo entrega como string; sin este casteo un ingreso real de
 * $899 se leería como 0.
 */
const n = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

/** Fecha en ISO (YYYY-MM-DD) para comparar contra columnas `date` de Postgres. */
const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

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
  const [
    createdRow,
    qualifiedRow,
    wonRow,
    lostRow,
    quotesSentRow,
    quotesApprovedRow,
    paymentsRow,
    expensesRow,
    insightRow,
    payingRow,
  ] =
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
      // Leads calificados: entraron a una etapa kind=qualified (distintos,
      // para no doble-contar si un lead sale y vuelve a entrar).
      db
        .select({ value: sql<number>`count(distinct ${schema.leadStageEvent.leadId})` })
        .from(schema.leadStageEvent)
        .where(
          and(
            orgScope(schema.leadStageEvent.organizationId),
            eq(schema.leadStageEvent.toStageKind, "qualified"),
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
      // Gasto real persistido por el poller de Meta Ads (no el presupuesto planeado).
      db
        .select({
          spend: sql<number>`coalesce(sum(${schema.campaignInsight.spendCents}), 0)`,
          cnt: count(),
        })
        .from(schema.campaignInsight)
        .where(
          and(
            orgScope(schema.campaignInsight.organizationId),
            gte(schema.campaignInsight.dateStart, isoDate(from)),
            lte(schema.campaignInsight.dateStart, isoDate(to))
          )
        ),
      // Clientes pagadores únicos (contactos con al menos un cobro en el periodo).
      db
        .select({ customers: sql<number>`count(distinct ${schema.payment.contactId})` })
        .from(schema.payment)
        .where(
          and(
            orgScope(schema.payment.organizationId),
            isNotNull(schema.payment.contactId),
            gte(schema.payment.fecha, from),
            lte(schema.payment.fecha, to)
          )
        ),
    ]);

  const newLeads = n(createdRow[0]?.value);
  const qualifiedLeads = n(qualifiedRow[0]?.value);
  const won = n(wonRow[0]?.value);
  const lost = n(lostRow[0]?.value);
  const quotesSent = n(quotesSentRow[0]?.value);
  const quotesApproved = n(quotesApprovedRow[0]?.value);
  const revenue = n(paymentsRow[0]?.total);
  const paymentsCount = n(paymentsRow[0]?.cnt);
  const expenses = n(expensesRow[0]?.total);
  const adSpendCents = n(insightRow[0]?.spend);
  const hasInsights = n(insightRow[0]?.cnt) > 0;
  const payingCustomers = n(payingRow[0]?.customers);

  // La tabla campaign guarda presupuesto planeado, no gasto realizado. El gasto
  // real viene de campaign_insight (poller de Meta Ads); el presupuesto solo
  // sirve como referencia planeada, nunca como inversión para ROAS/ROMI/CAC.
  const campaignRows = await db
    .select({
      plannedBudget: sql<number>`coalesce(sum(${schema.campaign.budgetPlannedCents}), 0)`,
      campaigns: count(),
    })
    .from(schema.campaign)
    .where(and(orgScope(schema.campaign.organizationId), gte(schema.campaign.createdAt, from), lte(schema.campaign.createdAt, to)));
  const plannedBudget = n(campaignRows[0]?.plannedBudget);
  const hasCampaigns = n(campaignRows[0]?.campaigns) > 0;

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
  // Contribución de prestación: se informa antes de publicidad porque aún no
  // hay un dato de gasto realizado atribuible en la tabla de campañas.
  const contrib = hasCosts ? contribution(revenue, totalDeliveryCost) : null;

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

  // ── Operaciones: tiempo de respuesta (entrada → primera salida) ──
  // Se calcula sobre la tabla `message` (la fuente real de la mensajería),
  // emparejando cada mensaje entrante con la siguiente salida en su conversación.
  const responseRows = await db
    .select({
      conversationId: schema.message.conversationId,
      direction: schema.message.direction,
      createdAt: schema.message.createdAt,
    })
    .from(schema.message)
    .where(
      and(
        orgScope(schema.message.organizationId),
        gte(schema.message.createdAt, from),
        lte(schema.message.createdAt, to),
        inArray(schema.message.direction, ["in", "out"])
      )
    )
    .orderBy(schema.message.conversationId, schema.message.createdAt)
    .limit(5000);

  const pendingInbound = new Map<string, Date>();
  const responseGapsHours: number[] = [];
  for (const m of responseRows) {
    const conv = m.conversationId;
    if (!conv) continue;
    if (m.direction === "in") {
      // Guarda solo la entrada más reciente sin respuesta de esa conversación.
      pendingInbound.set(conv, m.createdAt);
    } else {
      const inAt = pendingInbound.get(conv);
      if (inAt) {
        responseGapsHours.push((m.createdAt.getTime() - inAt.getTime()) / 3_600_000);
        pendingInbound.delete(conv); // una respuesta por entrada
      }
    }
  }
  const avgResponseHours =
    responseGapsHours.length > 0
      ? responseGapsHours.reduce((a, b) => a + b, 0) / responseGapsHours.length
      : null;

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
      // Embudo secuencial de 3 tramos: Prospectos → Calificados → Cotizados →
      // Ganados. "Perdidos" no es una etapa por la que se avanza (es un destino
      // final), por eso no entra al gráfico de embudo.
      stages: [
        { stage: "Prospectos", value: newLeads },
        { stage: "Calificados", value: qualifiedLeads },
        { stage: "Cotizados", value: quotesSent },
        { stage: "Ganados", value: won },
      ],
      leadToQualified: maybe(conversionRate(qualifiedLeads, newLeads)),
      qualifiedToQuote: maybe(conversionRate(quotesSent, qualifiedLeads)),
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
      plannedBudget: hasCampaigns ? num(plannedBudget) : unavailable("no_data"),
      // Gasto real persistido por el poller; "no_data" si aún no hay insights.
      adSpend: hasInsights ? num(adSpendCents) : unavailable("no_data"),
      // ROAS/ROMI necesitan ingresos ATRIBUIDOS a campañas; con ingresos totales
      // se sobreestimarían, así que siguen pendientes hasta tener atribución.
      roas: unavailable("pending"),
      romi: unavailable("pending"),
      // CAC pagador: inversión real ÷ clientes que sí pagaron en el periodo.
      cac: maybe(
        hasInsights && payingCustomers > 0 ? adSpendCents / payingCustomers : null,
        payingCustomers === 0 ? "not_applicable" : "no_data"
      ),
      // CPQL: inversión real ÷ leads calificados en el periodo.
      cpql: maybe(
        hasInsights && qualifiedLeads > 0 ? adSpendCents / qualifiedLeads : null,
        qualifiedLeads === 0 ? "not_applicable" : "no_data"
      ),
    },

    // La capa de tráfico (GA4) se resuelve en la ruta (aquí solo el estado
    // inicial); session_to_lead combina sesiones de GA4 con nuevos prospectos.
    trafico: {
      sessions: unavailable("pending"),
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
      responseTimeHours: maybe(avgResponseHours, "no_data"),
      activitiesLogged: num(responseGapsHours.length),
    },

    calidad: {
      contactsWithChannel: maybe(conversionRate(contactsWithChannel, totalContacts), "no_data"),
      totalContacts: num(totalContacts),
      contactsWithChannelCount: num(contactsWithChannel),
    },
  } as const;
}

export type CommercialData = Awaited<ReturnType<typeof queryCommercial>>;
