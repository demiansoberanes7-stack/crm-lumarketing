"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  ChevronDown,
  DollarSign,
  Factory,
  Headset,
  LineChart,
  Server,
  ShoppingBag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { KpiCard, formatCurrency, formatPercent } from "./kpi-card";
import { ProjectsSection } from "./sections/projects-section";
import { TasksSection } from "./sections/tasks-section";
import { QuotesSection } from "./sections/quotes-section";
import { ReceivablesSection } from "./sections/receivables-section";
import { ProfitabilitySection } from "./sections/profitability-section";
import { InboxSection } from "./sections/inbox-section";
import { ContactsSection } from "./sections/contacts-section";
import { MarketingSection } from "./marketing-section";
import { CommercialSection } from "./commercial-section";
import { GanttSection } from "./gantt-section";
import { FunnelSection } from "./funnel-section";
import { HealthSection } from "./health-section";
import { AdsMetricsSection } from "./ads-section";
import { OriginLegend, OriginGroup } from "./metric-badge";

/** Sección colapsable por departamento. */
function Department({ id, title, icon, defaultOpen = true, children }: {
  id: string; title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`${id}-body`}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-accent sm:px-5"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand-text">{icon}</span>
          <span className="truncate text-sm font-semibold">{title}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id={`${id}-body`} className="space-y-4 border-t p-3 sm:p-4">
          {children}
        </div>
      )}
    </section>
  );
}

interface DashboardData {
  period: string;
  range: { from: string; to: string; timezone: string };
  projects: {
    total: number; active: number; archived: number; completed: number;
    completionRate: number; avgAdvance: number; highRisk: number;
    projectsByStage: { name: string; count: number }[];
    projectsByAssignee: { name: string; count: number }[];
    avgTimeByStage: { stage: string; avgDays: number }[];
  };
  tasks: {
    total: number; completed: number; pending: number; notStarted: number;
    completedThisWeek: number; pendingDueSoon: number; overdue: number; unassigned: number;
    byPriority: { name: string; count: number }[];
  };
  quotes: {
    total: number; sent: number; approved: number; approvalRate: number | null; excludedCurrency: number;
    avgTicket: number; pipelineValue: number; avgDiscount: number;
    byMonth: { month: string; sent: number; approved: number }[];
    byChannel: { name: string; count: number }[];
  };
  receivables: {
    totalPending: number; overdueCount: number; overdueAmount: number;
    overdueRate: number | null;
    aging: { bucket: string; amount: number }[];
    topDebtors: { id: string; concept: string; amount: number }[];
  };
  payments: {
    grossIncome: number; count: number; avgTicket: number;
    withReceipt: number; withReceiptRate: number;
    byMethod: { name: string; amount: number }[];
    byMonth: { month: string; amount: number }[];
  };
  expenses: {
    total: number; expenseVsIncome: number | null;
    byCategory: { name: string; amount: number }[];
    bySupplier: { name: string; amount: number }[];
    byMonth: { month: string; amount: number }[];
  };
  profitability: {
    netIncome: number; margin: number | null;
    incomeVsExpenses: { month: string; income: number; expense: number }[];
    weeklyCashFlow: { week: string; income: number; expense: number; net: number }[];
  };
  inbox: { active: number; byChannel: { name: string; count: number }[] };
  contacts: {
    total: number; active: number; newThisPeriod: number; activityRate: number | null;
    bySource: { name: string; count: number }[];
  };
  gantt: {
    projects: { id: string; name: string; progress: number; startDate: string; endDate: string | null; status: string; risk: string | null }[];
    tasks: { id: string; title: string; status: string; priority: string | null; startDate: string; endDate: string | null }[];
  };
  ads: {
    attributedLeads: number; attributedConversations: number; convertedFromAds: number;
    conversions: { sent: number; pending: number; failed: number };
  };
  velocity: { closedThisPeriod: number; avgDaysToClose: number; fastestCloseDays: number; slowestCloseDays: number };
  margin: { serviceCostTotal: number; contribution: number; contributionPct: number | null; byService: { name: string; amount: number }[] };
  funnels: {
    commercial: { stage: string; value: number }[];
    channel: { stage: string; value: number }[];
    byChannel: { name: string; count: number }[];
  };
  health: {
    errors24h: { automations: number; webhooks: number; capi: number; messages: number; total: number };
  };
}

const PERIODS = [
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "90d", label: "90 días" },
  { value: "1y", label: "1 año" },
];

export function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [period, setPeriod] = useState("30d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/dashboard?period=${period}`, { signal });
      if (!res.ok) throw new Error("Error al cargar datos");
      const json = (await res.json()) as DashboardData;
      if (!signal?.aborted) setData(json);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Error desconocido"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [period]);

  useEffect(() => { const controller = new AbortController(); void fetchData(controller.signal); return () => controller.abort(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Cargando dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <button onClick={() => void fetchData()} className="text-sm underline">Reintentar</button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="header-surface sticky top-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">Hola, bienvenido de nuevo 👋</h1>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`min-h-11 rounded-md px-3 text-xs font-medium transition-colors ${
                period === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 space-y-4 p-4 sm:p-6">
        <p className="text-xs text-muted-foreground">
          {data.period}: {data.range.from.slice(0, 10)} a {data.range.to.slice(0, 10)} (UTC). Importes en MXN.
        </p>
        <OriginLegend />

        {/* ── DIRECCIÓN / GENERAL ─────────────── */}
        <Department id="dir" title="Dirección · General" icon={<Building2 className="h-4 w-4" />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard title="Ingresos" value={formatCurrency(data.payments.grossIncome)} icon={<DollarSign />} />
            <KpiCard title="Gastos" value={formatCurrency(data.expenses.total)} />
            <KpiCard title="Resultado de caja" value={formatCurrency(data.profitability.netIncome)}
              trend={data.profitability.netIncome === 0 ? "neutral" : data.profitability.netIncome > 0 ? "up" : "down"}
              trendValue={`${formatPercent(data.profitability.margin)} margen`} />
            <KpiCard title="Por Cobrar" value={formatCurrency(data.receivables.totalPending)} subtitle={`${data.receivables.overdueCount} vencidos`} />
            <KpiCard title="Margen de contribución" value={formatCurrency(data.margin.contribution)}
              subtitle={data.margin.contributionPct != null ? `${formatPercent(data.margin.contributionPct)} tras costos de servicio` : "Sin costos de servicio"} />
            <KpiCard title="Proyectos activos" value={data.projects.active} subtitle={`${data.projects.archived} archivados`} />
          </div>
          <ProfitabilitySection data={data.profitability} />
          <ReceivablesSection data={data.receivables} />
        </Department>

        {/* ── COMERCIAL / VENTAS ───────────────── */}
        <Department id="com" title="Comercial · Ventas" icon={<ShoppingBag className="h-4 w-4" />} defaultOpen={false}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard title="Ticket promedio" value={formatCurrency(data.quotes.avgTicket)} subtitle="cotizaciones aprobadas" />
            <KpiCard title="Tasa de aprobación" value={formatPercent(data.quotes.approvalRate)} subtitle={`${data.quotes.approved}/${data.quotes.sent} enviadas`} />
            <KpiCard title="Pipeline vigente" value={formatCurrency(data.quotes.pipelineValue)} subtitle="borrador + enviadas" />
            <KpiCard title="Velocidad de cierre" value={data.velocity.avgDaysToClose > 0 ? `${data.velocity.avgDaysToClose.toFixed(0)} d` : "N/D"}
              subtitle={data.velocity.closedThisPeriod > 0 ? `${data.velocity.closedThisPeriod} cerrados · (${data.velocity.fastestCloseDays.toFixed(0)}–${data.velocity.slowestCloseDays.toFixed(0)} d)` : "Sin cierres en el período"} />
          </div>
          <FunnelSection title="Embudo comercial" stages={data.funnels.commercial}
            hint="De nuevos prospectos a cliente activo. Haz clic en una etapa para ver la caída." />
          <QuotesSection data={data.quotes} />
          <CommercialSection period={period} />
        </Department>

        {/* ── MARKETING / PUBLICIDAD ───────────── */}
        <Department id="mkt" title="Marketing · Publicidad" icon={<LineChart className="h-4 w-4" />} defaultOpen={false}>
          <OriginGroup origin="external" label="Datos de la plataforma (GA4)">
            <MarketingSection period={period} />
          </OriginGroup>
          <OriginGroup origin="mixed" label="Atribución ads → CRM">
            <AdsMetricsSection ads={data.ads} />
          </OriginGroup>
          <OriginGroup origin="system" label="Contactos del CRM">
            <ContactsSection data={data.contacts} />
          </OriginGroup>
        </Department>

        {/* ── OPERACIONES / PROYECTOS ──────────── */}
        <Department id="ops" title="Operaciones · Proyectos" icon={<Factory className="h-4 w-4" />} defaultOpen={false}>
          <GanttSection
            projects={data.gantt.projects.map((p) => ({ id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate, progress: p.progress, status: p.status }))}
            tasks={data.gantt.tasks.map((t) => ({ id: t.id, name: t.title, startDate: t.startDate, endDate: t.endDate, status: t.status, priority: t.priority }))}
          />
          <ProjectsSection data={data.projects} />
          <TasksSection data={data.tasks} />
        </Department>

        {/* ── SOPORTE / BANDEJA ────────────────── */}
        <Department id="sup" title="Soporte · Bandeja" icon={<Headset className="h-4 w-4" />} defaultOpen={false}>
          <FunnelSection title="Embudo por canal" stages={data.funnels.channel}
            hint="De mensajes entrantes a cierre exitoso. Haz clic en una etapa para ver la caída." />
          <InboxSection data={data.inbox} />
        </Department>

        {/* ── INFRAESTRUCTURA / CALIDAD ────────── */}
        <Department id="infra" title="Infraestructura · Calidad" icon={<Server className="h-4 w-4" />} defaultOpen={false}>
          <HealthSection health={data.health} />
        </Department>
      </div>
    </div>
  );
}
