import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Datos del panel de operaciones del dashboard.
 *
 * Todo sale de tablas que el CRM ya escribe. Lo que NO existe se declara como
 * tal y la interfaz lo pinta como ausente: no hay estado «running/idle» del
 * agente (los turnos silenciosos solo van al log), así que el estado se deriva
 * de señales que sí son reales —perfil encendido, canales apagados, última
 * respuesta de IA, traspasos— y no se inventa uno.
 */
export type OpsAgent = {
  configured: boolean;
  name: string | null;
  enabled: boolean;
  disabledChannels: string[];
  aiReplies24h: number;
  manualReplies24h: number;
  lastAiReplyAt: string | null;
  activeConversations: number;
  handoffs24h: number;
};

export type OpsSeriesPoint = {
  day: string;
  ai: number;
  manual: number;
  inbound: number;
};

export type OpsScheduledTask = {
  id: string;
  ruleId: string;
  status: string;
  scheduledAt: string;
  error: string | null;
};

export type OpsActivityItem = {
  id: string;
  kind: "cotizacion" | "etapa" | "agente";
  title: string;
  detail: string | null;
  at: string;
  href: string;
};

export type OpsData = {
  agent: OpsAgent;
  series: OpsSeriesPoint[];
  scheduled: OpsScheduledTask[];
  activity: OpsActivityItem[];
  /** Ventana del gráfico, para que el cliente rellene días sin actividad. */
  from: string;
  to: string;
};

const CACHE_TTL_MS = 60_000;
const opsCache = new Map<string, { data: OpsData; expiresAt: number }>();

const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

export function opsPeriodStart(period: string, now = new Date()): Date {
  const days = PERIOD_DAYS[period] ?? 30;
  return new Date(now.getTime() - days * 86_400_000);
}

/** Serie diaria: los días sin mensajes no vienen en el agregado, se rellenan. */
export function fillSeries(
  points: OpsSeriesPoint[],
  from: Date,
  to: Date
): OpsSeriesPoint[] {
  const byDay = new Map(points.map((p) => [p.day, p]));
  const out: OpsSeriesPoint[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  );
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  // Tope defensivo: una serie anual son 366 puntos, no una lista sin fin.
  for (let i = 0; cursor.getTime() <= last && i < 400; i += 1) {
    const day = cursor.toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, ai: 0, manual: 0, inbound: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export async function queryOps(
  orgId: string,
  period: string,
  now = new Date()
): Promise<OpsData> {
  const cacheKey = `${orgId}:${period}`;
  const cached = opsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const db = getDb();
  const from = opsPeriodStart(period, now);
  const since24h = new Date(now.getTime() - 86_400_000);
  // Drizzle anula los serializadores de fecha de postgres.js: un Date crudo
  // interpolado en `sql` (sin columna que lo codifique) revienta en Bind.
  const since24hIso = since24h.toISOString();
  const m = schema.message;
  const c = schema.conversation;

  const [profileRows, conversationRow, msg24Row, lastAiRow, seriesRows, schedRows, quoteRows, stageRows, agentRows] =
    await Promise.all([
      db
        .select({
          enabled: schema.agentProfile.enabled,
          name: schema.agentProfile.name,
          disabledChannels: schema.agentProfile.disabledChannels,
        })
        .from(schema.agentProfile)
        .where(eq(schema.agentProfile.organizationId, orgId))
        .limit(1),
      db
        .select({
          // «Activa» sin estado en la tabla solo puede significar «con mensajes
          // en las últimas 24 h»; no se cuenta la cartera histórica.
          active: sql<number>`count(*) filter (where ${c.lastMessageAt} >= ${since24hIso}::timestamptz)::int`,
          handoffs: sql<number>`count(*) filter (where ${c.handoffAt} >= ${since24hIso}::timestamptz)::int`,
        })
        .from(c)
        .where(and(eq(c.organizationId, orgId), eq(c.isTest, false))),
      db
        .select({
          ai: sql<number>`count(*) filter (where ${m.aiGenerated} and ${m.direction} = 'out')::int`,
          manual: sql<number>`count(*) filter (where not ${m.aiGenerated} and ${m.direction} = 'out' and ${m.status} <> 'failed')::int`,
        })
        .from(m)
        .where(and(eq(m.organizationId, orgId), gte(m.createdAt, since24h))),
      db
        .select({ at: sql<string | null>`max(${m.createdAt})` })
        .from(m)
        .where(
          and(
            eq(m.organizationId, orgId),
            eq(m.aiGenerated, true),
            eq(m.direction, "out"),
            sql`${m.status} <> 'failed'`
          )
        ),
      db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${m.createdAt}), 'YYYY-MM-DD')`,
          ai: sql<number>`count(*) filter (where ${m.aiGenerated} and ${m.direction} = 'out')::int`,
          manual: sql<number>`count(*) filter (where not ${m.aiGenerated} and ${m.direction} = 'out' and ${m.status} <> 'failed')::int`,
          inbound: sql<number>`count(*) filter (where ${m.direction} = 'in')::int`,
        })
        .from(m)
        .where(and(eq(m.organizationId, orgId), gte(m.createdAt, from)))
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      db
        .select({
          id: schema.automationExecution.id,
          ruleId: schema.automationExecution.ruleId,
          status: schema.automationExecution.status,
          scheduledAt: schema.automationExecution.scheduledAt,
          error: schema.automationExecution.error,
        })
        .from(schema.automationExecution)
        .where(
          and(
            eq(schema.automationExecution.organizationId, orgId),
            inArray(schema.automationExecution.status, [
              "queued",
              "running",
              "failed",
              "error",
            ])
          )
        )
        .orderBy(desc(schema.automationExecution.scheduledAt))
        .limit(8),
      db
        .select({
          id: schema.quoteEvent.id,
          eventType: schema.quoteEvent.eventType,
          quoteId: schema.quoteEvent.quoteId,
          createdAt: schema.quoteEvent.createdAt,
        })
        .from(schema.quoteEvent)
        .where(eq(schema.quoteEvent.organizationId, orgId))
        .orderBy(desc(schema.quoteEvent.createdAt))
        .limit(6),
      db
        .select({
          id: schema.leadStageEvent.id,
          toStageName: schema.leadStageEvent.toStageName,
          contactId: schema.leadStageEvent.contactId,
          occurredAt: schema.leadStageEvent.occurredAt,
        })
        .from(schema.leadStageEvent)
        .where(eq(schema.leadStageEvent.organizationId, orgId))
        .orderBy(desc(schema.leadStageEvent.occurredAt))
        .limit(6),
      db
        .select({
          id: m.id,
          channel: c.channel,
          conversationId: m.conversationId,
          createdAt: m.createdAt,
        })
        .from(m)
        .innerJoin(c, eq(c.id, m.conversationId))
        .where(
          and(
            eq(m.organizationId, orgId),
            eq(m.aiGenerated, true),
            eq(m.direction, "out"),
            sql`${m.status} <> 'failed'`
          )
        )
        .orderBy(desc(m.createdAt))
        .limit(6),
    ]);

  const profile = profileRows[0];
  const series = fillSeries(
    seriesRows.map((r) => ({
      day: r.day,
      ai: Number(r.ai ?? 0),
      manual: Number(r.manual ?? 0),
      inbound: Number(r.inbound ?? 0),
    })),
    from,
    now
  );

  const activity: OpsActivityItem[] = [
    ...quoteRows.map((row) => ({
      id: `q-${row.id}`,
      kind: "cotizacion" as const,
      title: activityTitleForQuote(row.eventType),
      detail: null,
      at: row.createdAt.toISOString(),
      href: "/quotes",
    })),
    ...stageRows.map((row) => ({
      id: `s-${row.id}`,
      kind: "etapa" as const,
      title: `Oportunidad movida a «${row.toStageName}»`,
      detail: null,
      at: row.occurredAt.toISOString(),
      href: "/pipeline",
    })),
    ...agentRows.map((row) => ({
      id: `m-${row.id}`,
      kind: "agente" as const,
      title: "El agente respondió",
      detail: `Conversación de ${row.channel}`,
      at: row.createdAt.toISOString(),
      href: "/inbox",
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  const lastAi = lastAiRow[0]?.at;
  const data: OpsData = {
    agent: {
      configured: Boolean(profile),
      name: profile?.name ?? null,
      enabled: profile?.enabled ?? false,
      disabledChannels: (profile?.disabledChannels as string[] | undefined) ?? [],
      aiReplies24h: Number(msg24Row[0]?.ai ?? 0),
      manualReplies24h: Number(msg24Row[0]?.manual ?? 0),
      lastAiReplyAt: lastAi ? new Date(lastAi).toISOString() : null,
      activeConversations: Number(conversationRow[0]?.active ?? 0),
      handoffs24h: Number(conversationRow[0]?.handoffs ?? 0),
    },
    series,
    scheduled: schedRows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId,
      status: row.status,
      scheduledAt: row.scheduledAt.toISOString(),
      error: row.error,
    })),
    activity,
    from: from.toISOString(),
    to: now.toISOString(),
  };

  opsCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

/** Etiqueta legible del evento de cotización; el tipo crudo va en el detalle. */
export function activityTitleForQuote(eventType: string): string {
  const labels: Record<string, string> = {
    created: "Cotización creada",
    sent: "Cotización enviada al cliente",
    viewed: "El cliente abrió la cotización",
    accepted: "Cotización aceptada",
    rejected: "Cotización rechazada",
    expired: "Cotización vencida",
    cancelled: "Cotización cancelada",
  };
  return labels[eventType] ?? `Cotización: ${eventType}`;
}
