"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  DollarSign,
  FileText,
  FolderKanban,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { KpiCard, formatCurrency, formatPercent } from "./kpi-card";
import { ProjectsSection } from "./sections/projects-section";
import { TasksSection } from "./sections/tasks-section";
import { QuotesSection } from "./sections/quotes-section";
import { ReceivablesSection } from "./sections/receivables-section";
import { PaymentsSection } from "./sections/payments-section";
import { ExpensesSection } from "./sections/expenses-section";
import { ProfitabilitySection } from "./sections/profitability-section";
import { InboxSection } from "./sections/inbox-section";
import { ContactsSection } from "./sections/contacts-section";

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
  inbox: {
    active: number;
    byChannel: { name: string; count: number }[];
  };
  contacts: {
    total: number; active: number; newThisPeriod: number; activityRate: number | null;
    bySource: { name: string; count: number }[];
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
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
        <h1 className="text-lg font-bold tracking-tight">Dashboard</h1>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                period === p.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 space-y-6 p-4 sm:p-6">
        <p className="text-xs text-muted-foreground">{data.period}: {data.range.from.slice(0, 10)} a {data.range.to.slice(0, 10)} (UTC). Importes en MXN. Pagos, gastos, cotizaciones creadas y actividad de bandeja usan el período elegido. Cartera, proyectos, tareas y contactos muestran el estado actual.</p>
        {/* ── TOP KPIs ─────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard title="Ingresos" value={formatCurrency(data.payments.grossIncome)} icon={<DollarSign />} />
          <KpiCard title="Gastos" value={formatCurrency(data.expenses.total)} icon={<Wallet />} />
          <KpiCard title="Resultado de caja" value={formatCurrency(data.profitability.netIncome)} icon={<TrendingUp />}
            trend={data.profitability.netIncome === 0 ? "neutral" : data.profitability.netIncome > 0 ? "up" : "down"} trendValue={`${formatPercent(data.profitability.margin)} margen`} />
          <KpiCard title="Por Cobrar" value={formatCurrency(data.receivables.totalPending)} icon={<Clock />}
            subtitle={`${data.receivables.overdueCount} vencidos`} />
          <KpiCard title="Cotizaciones aprobadas" value={data.quotes.approved} icon={<FileText />}
            subtitle={`${formatPercent(data.quotes.approvalRate)} aprobación`} />
          <KpiCard title="Proyectos" value={data.projects.active} icon={<FolderKanban />}
            subtitle={`${data.projects.archived} archivados`} />
        </div>

        {/* ── SECCIONES ────────────────────────── */}
        <ProjectsSection data={data.projects} />
        <TasksSection data={data.tasks} />
        <QuotesSection data={data.quotes} />
        <ReceivablesSection data={data.receivables} />
        <PaymentsSection data={data.payments} />
        <ExpensesSection data={data.expenses} />
        <ProfitabilitySection data={data.profitability} />
        <InboxSection data={data.inbox} />
        <ContactsSection data={data.contacts} />
      </div>
    </div>
  );
}
