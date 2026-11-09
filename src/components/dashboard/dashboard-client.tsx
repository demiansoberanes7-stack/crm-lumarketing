"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
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
import { HealthSection } from "./health-section";
import { AdsMetricsSection } from "./ads-section";
import { OriginLegend, OriginGroup } from "./metric-badge";

// Todo lo que dibuja con recharts se pide aparte (ssr: false): el dashboard es
// "use client" y sus hijos solo cargan datos en el navegador, así que el
// bundle inicial no arrastra la librería de gráficas.
const OpsOverview = dynamic(() => import("./ops-overview").then((m) => m.OpsOverview), { ssr: false });
const ProjectsSection = dynamic(() => import("./sections/projects-section").then((m) => m.ProjectsSection), { ssr: false });
const TasksSection = dynamic(() => import("./sections/tasks-section").then((m) => m.TasksSection), { ssr: false });
const QuotesSection = dynamic(() => import("./sections/quotes-section").then((m) => m.QuotesSection), { ssr: false });
const ReceivablesSection = dynamic(() => import("./sections/receivables-section").then((m) => m.ReceivablesSection), { ssr: false });
const ProfitabilitySection = dynamic(() => import("./sections/profitability-section").then((m) => m.ProfitabilitySection), { ssr: false });
const InboxSection = dynamic(() => import("./sections/inbox-section").then((m) => m.InboxSection), { ssr: false });
const ContactsSection = dynamic(() => import("./sections/contacts-section").then((m) => m.ContactsSection), { ssr: false });
const MarketingSection = dynamic(() => import("./marketing-section").then((m) => m.MarketingSection), { ssr: false });
const CommercialSection = dynamic(() => import("./commercial-section").then((m) => m.CommercialSection), { ssr: false });
const GanttSection = dynamic(() => import("./gantt-section").then((m) => m.GanttSection), { ssr: false });
const FunnelSection = dynamic(() => import("./funnel-section").then((m) => m.FunnelSection), { ssr: false });

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

export function DashboardClient({ userName }: { userName: string }) {
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
      {/* Cabecera discreta: contexto del módulo y el período. El saludo vive
          dentro del contenido, no aquí. */}
      <header className="header-surface sticky top-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="min-w-0">
          <p className="kicker">Inicio</p>
          <p className="truncate text-[12.5px] text-text-2">
            {data.period} · {data.range.from.slice(0, 10)} a {data.range.to.slice(0, 10)} (UTC) · MXN
          </p>
        </div>
        <div
          role="group"
          aria-label="Período del panel"
          className="flex items-center gap-0.5 rounded-lg border border-border bg-subtle p-0.5"
        >
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              aria-pressed={period === p.value}
              className={cn(
                "min-h-9 rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150",
                period === p.value
                  ? "bg-background text-foreground shadow-xs"
                  : "text-text-2 hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 space-y-4 p-4 sm:p-6">
        <OpsOverview
          period={period}
          userName={userName}
          kpis={{
            newProspects: data.contacts.newThisPeriod,
            quotesSent: data.quotes.sent,
            pipelineValue: data.quotes.pipelineValue,
            grossIncome: data.payments.grossIncome,
            activeConversations: data.inbox.active,
            overdueTasks: data.tasks.overdue,
          }}
        />

        <div className="mt-2 px-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Detalle por área</h2>
          <p className="mt-0.5 text-[12px] text-text-2">
            Cada bloque declara de dónde sale su dato antes de mostrar una cifra.
          </p>
        </div>
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
          <OriginGroup origin="system" label="Clientes del CRM">
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
