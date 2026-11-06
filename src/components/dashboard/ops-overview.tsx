"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  CircleAlert,
  Inbox,
  MessagesSquare,
  Sparkles,
  Wallet,
} from "lucide-react";
import type { OpsData } from "@/server/dashboard/ops";
import { AreaChartCard } from "./charts";
import { cn } from "@/lib/utils";

/**
 * Inicio al estilo panel de operaciones.
 *
 * La composición —tarjetas blancas sobre lienzo, métricas arriba, gráfico
 * ancho con panel lateral, y actividad/programadas abajo— viene de la
 * referencia; los números vienen de `/api/dashboard` y `/api/dashboard/ops`.
 * Lo que no existe en el backend (estado «running» del agente, actividad por
 * hora) no se dibuja como si existiera: se declara ausente.
 */

export type OverviewKpis = {
  newProspects: number;
  quotesSent: number;
  pipelineValue: number;
  grossIncome: number;
  activeConversations: number;
  overdueTasks: number;
};

const PERIOD_LABEL: Record<string, string> = {
  "7d": "últimos 7 días",
  "30d": "últimos 30 días",
  "90d": "últimos 90 días",
  "1y": "último año",
};

export function OpsOverview({
  period,
  kpis,
  userName,
}: {
  period: string;
  kpis: OverviewKpis;
  userName: string;
}) {
  const [ops, setOps] = useState<OpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/dashboard/ops?period=${period}`, { signal });
        if (!res.ok) throw new Error("ops_failed");
        const json = (await res.json()) as OpsData;
        if (!signal?.aborted) setOps(json);
      } catch {
        // Un fallo de lectura no es «no hay actividad»: se dice y se reintenta.
        if (!signal?.aborted) setFailed(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [period]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  const today = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <section className="space-y-4">
      {/* Bienvenida: contexto, no un saludo vacío. */}
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="kicker" suppressHydrationWarning>{today}</p>
          <h2
            className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[30px]"
            suppressHydrationWarning
          >
            {greeting}, {userName}
          </h2>
          <p className="mt-1 text-[13px] text-text-2">
            {ops
              ? `${ops.agent.aiReplies24h} respuestas del agente y ${ops.agent.manualReplies24h} del equipo en las últimas 24 h.`
              : "Resumen de las últimas 24 horas."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border bg-background px-3 py-1.5 text-[12px] font-medium text-text-2">
            {kpis.activeConversations} conversaciones en el período
          </span>
          <span
            className={cn(
              "rounded-full px-3 py-1.5 text-[12px] font-medium",
              kpis.overdueTasks > 0
                ? "bg-warning-tint text-warning-text"
                : "bg-success-tint text-success-text"
            )}
          >
            {kpis.overdueTasks > 0
              ? `${kpis.overdueTasks} tareas vencidas`
              : "Sin tareas vencidas"}
          </span>
        </div>
      </div>

      {/* Métricas clave */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={<Sparkles className="h-4 w-4" />}
          label="Respuestas del agente (24 h)"
          value={ops ? String(ops.agent.aiReplies24h) : "—"}
          hint={ops ? `${ops.agent.manualReplies24h} del equipo` : "Cargando…"}
        />
        <Metric
          icon={<Inbox className="h-4 w-4" />}
          label="Prospectos nuevos"
          value={String(kpis.newProspects)}
          hint="en el período elegido"
        />
        <Metric
          icon={<MessagesSquare className="h-4 w-4" />}
          label="Cotizaciones enviadas"
          value={String(kpis.quotesSent)}
          hint="en el período elegido"
        />
        <Metric
          icon={<Wallet className="h-4 w-4" />}
          label="Ingresos registrados"
          value={money(kpis.grossIncome)}
          hint={`pipeline ${money(kpis.pipelineValue)}`}
        />
      </div>

      {/* Gráfico + estado del agente */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Panel
          title="Rendimiento del agente"
          subtitle="Respuestas automáticas frente a humanas, por día"
          action={
            <span className="text-[11px] font-medium text-text-3">
              {PERIOD_LABEL[period] ?? period}
            </span>
          }
        >
          {loading ? (
            <ChartSkeleton />
          ) : failed ? (
            <InlineError onRetry={() => void load()} />
          ) : ops && ops.series.every((p) => p.ai + p.manual + p.inbound === 0) ? (
            <EmptyState
              title="Todavía no hay mensajes en este período"
              hint="Cuando llegue el primer mensaje verás aquí la actividad diaria."
            />
          ) : (
            <AreaChartCard
              data={ops?.series ?? []}
              xKey="day"
              yKeys={["ai", "manual"]}
              labels={{ ai: "Agente", manual: "Equipo" }}
              height={252}
            />
          )}
        </Panel>

        <Panel title="Agente de IA" subtitle="Estado real de esta organización">
          {loading ? (
            <ChartSkeleton />
          ) : failed ? (
            <InlineError onRetry={() => void load()} />
          ) : ops ? (
            <AgentCard data={ops.agent} />
          ) : null}
        </Panel>
      </div>

      {/* Actividad + programadas */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Actividad reciente"
          subtitle="Cotizaciones, etapas y respuestas del agente"
          action={
            <Link href="/inbox" className="inline-flex items-center gap-1 text-[12px] font-medium text-text-2 hover:text-foreground">
              Bandeja <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          {loading ? (
            <ListSkeleton />
          ) : failed ? (
            <InlineError onRetry={() => void load()} />
          ) : ops && ops.activity.length === 0 ? (
            <EmptyState
              title="Sin actividad registrada"
              hint="Las cotizaciones, los cambios de etapa y las respuestas del agente aparecen aquí."
            />
          ) : (
            <ul className="divide-y divide-border">
              {ops?.activity.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-subtle"
                  >
                    <span
                      className={cn(
                        "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                        item.kind === "agente"
                          ? "bg-brand"
                          : item.kind === "etapa"
                            ? "bg-info"
                            : "bg-success"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{item.title}</span>
                      {item.detail ? (
                        <span className="block truncate text-[12px] text-text-2">{item.detail}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-[11px] text-text-3">{timeAgo(item.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Tareas programadas"
          subtitle="Cola de automatizaciones pendiente o con fallo"
          action={
            <Link href="/broadcasts" className="inline-flex items-center gap-1 text-[12px] font-medium text-text-2 hover:text-foreground">
              Automatizaciones <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          }
        >
          {loading ? (
            <ListSkeleton />
          ) : failed ? (
            <InlineError onRetry={() => void load()} />
          ) : ops && ops.scheduled.length === 0 ? (
            <EmptyState
              title="Nada en la cola"
              hint="Los seguimientos programados y sus reintentos aparecen aquí cuando existen."
            />
          ) : (
            <ul className="divide-y divide-border">
              {ops?.scheduled.map((task) => (
                <li key={task.id} className="flex items-center gap-3 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-subtle text-text-2">
                    <Bot className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{task.ruleId}</span>
                    <span className="block truncate text-[12px] text-text-2">
                      {task.error ? task.error : whenLabel(task.scheduledAt)}
                    </span>
                  </span>
                  <StatusPill status={task.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[12px] text-text-2">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-xs transition-shadow duration-200 hover:shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[12px] font-medium text-text-2">{label}</p>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-subtle text-text-2">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-[24px] font-semibold tabular-nums leading-none tracking-[-0.02em]">
        {value}
      </p>
      <p className="mt-1.5 truncate text-[11.5px] text-text-3">{hint}</p>
    </div>
  );
}

function AgentCard({ data }: { data: OpsData["agent"] }) {
  const state = !data.configured
    ? { label: "Sin configurar", tone: "warning" as const }
    : !data.enabled
      ? { label: "Apagado", tone: "neutral" as const }
      : data.disabledChannels.length > 0
        ? { label: "Activo con canales apagados", tone: "warning" as const }
        : { label: "Activo", tone: "ok" as const };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-text">
          <Bot className="h-5 w-5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{data.name ?? "Agente de IA"}</p>
          <p className="truncate text-[12px] text-text-2">
            {data.lastAiReplyAt
              ? `Última respuesta ${timeAgo(data.lastAiReplyAt)}`
              : "Sin respuestas todavía"}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            state.tone === "ok"
              ? "bg-success-tint text-success-text"
              : state.tone === "warning"
                ? "bg-warning-tint text-warning-text"
                : "bg-subtle text-text-2"
          )}
        >
          {state.label}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Conversaciones (24 h)" value={String(data.activeConversations)} />
        <Stat label="Traspasos (24 h)" value={String(data.handoffs24h)} />
        <Stat label="Respuestas IA (24 h)" value={String(data.aiReplies24h)} />
        <Stat label="Canales apagados" value={String(data.disabledChannels.length)} />
      </dl>

      {data.disabledChannels.length > 0 ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-warning-tint px-2.5 py-2 text-[11.5px] text-warning-text">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          No responde en: {data.disabledChannels.join(", ")}
        </p>
      ) : null}

      <Link
        href="/agent"
        className="inline-flex items-center gap-1 text-[12px] font-semibold text-text-2 hover:text-foreground"
      >
        Configurar el agente <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-subtle px-2.5 py-2">
      <dt className="truncate text-[11px] text-text-2">{label}</dt>
      <dd className="text-[16px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "failed" || status === "error"
      ? "bg-danger-tint text-danger-text"
      : status === "running"
        ? "bg-info-tint text-info-text"
        : "bg-subtle text-text-2";
  const label =
    status === "queued"
      ? "En cola"
      : status === "running"
        ? "Ejecutando"
        : status === "failed" || status === "error"
          ? "Falló"
          : status;
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", tone)}>
      {label}
    </span>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
      <p className="text-[13px] font-medium">{title}</p>
      <p className="mt-1 max-w-[38ch] text-[12px] text-text-2">{hint}</p>
    </div>
  );
}

function InlineError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-8 text-center">
      <p className="text-[13px] font-medium">No se pudo leer esta sección.</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold hover:bg-subtle"
      >
        Reintentar
      </button>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="animate-pulse space-y-2" aria-hidden>
      <div className="h-[210px] rounded-lg bg-subtle" />
      <div className="h-3 w-2/5 rounded bg-subtle" />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="animate-pulse space-y-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-10 rounded-lg bg-subtle" />
      ))}
    </div>
  );
}

function money(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(value);
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ayer" : `hace ${days} d`;
}

function whenLabel(iso: string) {
  const at = new Date(iso);
  const future = at.getTime() > Date.now();
  const label = new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return future ? `Programada para ${label}` : `Ejecutada ${label}`;
}
