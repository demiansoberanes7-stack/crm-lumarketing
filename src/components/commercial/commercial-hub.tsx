"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TrendingUp, Inbox, DollarSign, Target, Megaphone, MousePointerClick, Compass, Percent, FlaskConical, Headphones, ShieldCheck, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiCard, formatCurrency, formatNumber, formatPercent } from "@/components/dashboard/kpi-card";
import { FunnelChart, HorizontalBarChart } from "@/components/dashboard/charts";
import Link from "next/link";

/* ── Types (espejo de la respuesta de /api/commercial) ── */
type MetricValue = { value: number | null; availability: "available" | "no_data" | "not_applicable" | "pending"; formatted: string | null };

interface CommercialData {
  period: string;
  currency: string;
  resumen: Record<string, MetricValue>;
  ventas: Record<string, MetricValue>;
  embudo: { stages: { stage: string; value: number }[]; leadToWon: MetricValue; leadToQuote: MetricValue; quoteToWon: MetricValue; lossByReason: { key: string; label: string; value: number }[] };
  publicidad: Record<string, MetricValue>;
  trafico: Record<string, MetricValue>;
  adquisicion: { byChannel: { name: string; kind: string; count: number }[]; hasData: boolean };
  rentabilidad: Record<string, MetricValue> & { hasCosts: boolean };
  experimentos: { items: { id: string; name: string; status: string; evidenceStatus: string; primaryMetric: string | null }[]; total: number };
  operaciones: Record<string, MetricValue>;
  calidad: Record<string, MetricValue>;
}

const TABS = [
  { id: "resumen", label: "Resumen ejecutivo", icon: TrendingUp },
  { id: "ventas", label: "Ventas", icon: DollarSign },
  { id: "embudo", label: "Embudo", icon: Target },
  { id: "publicidad", label: "Publicidad", icon: Megaphone },
  { id: "trafico", label: "Tráfico digital", icon: MousePointerClick },
  { id: "adquisicion", label: "Adquisición", icon: Compass },
  { id: "rentabilidad", label: "Rentabilidad", icon: Percent },
  { id: "experimentos", label: "Experimentos", icon: FlaskConical },
  { id: "operaciones", label: "Operaciones", icon: Headphones },
  { id: "calidad", label: "Calidad de datos", icon: ShieldCheck },
] as const;

const PERIODS = [
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
  { id: "90d", label: "90 días" },
  { id: "1y", label: "1 año" },
] as const;

/* ── Presentación de una métrica con su disponibilidad ── */
function metricDisplay(m: MetricValue | undefined, formatter: (n: number) => string): { value: string; subtitle?: string } {
  if (!m) return { value: "—" };
  if (m.availability === "available" && m.value != null) return { value: formatter(m.value) };
  const reasons: Record<string, string> = {
    no_data: "Sin datos en el periodo",
    not_applicable: "No aplicable sin inversión",
    pending: "Requiere integración",
  };
  return { value: "N/D", subtitle: reasons[m.availability] ?? "No disponible" };
}

function MetricCard({ title, metric, formatter, icon }: { title: string; metric: MetricValue | undefined; formatter: (n: number) => string; icon?: React.ReactNode }) {
  const { value, subtitle } = metricDisplay(metric, formatter);
  const unavailable = metric && metric.availability !== "available";
  return <KpiCard title={title} value={value} subtitle={subtitle} icon={icon} className={unavailable ? "opacity-70" : undefined} />;
}

export function CommercialHub() {
  const [data, setData] = useState<CommercialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>("30d");
  const [tab, setTab] = useState<string>("resumen");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/commercial?period=${period}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData((await res.json()) as CommercialData);
    } catch {
      setError("No se pudieron cargar las métricas. Recarga para reintentar.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex h-full flex-col bg-background/50 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Control comercial</h1>
          <p className="text-sm text-muted-foreground">Métricas reales del CRM · {data?.period ?? "…"}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${period === p.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </Button>
          <Link
            href="/settings/marketing"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong bg-transparent px-3 text-xs font-semibold text-foreground transition-colors hover:border-foreground"
          >
            <Plug className="h-3.5 w-3.5" /> Integraciones
          </Link>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b px-6 py-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === t.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      <main className="flex-1 overflow-auto p-6">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" /> Cargando métricas…
          </div>
        )}
        {data && !loading && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {tab === "resumen" && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard title="Ingresos cobrados" metric={data.resumen.revenue} formatter={formatCurrency} icon={<DollarSign className="h-4 w-4" />} />
                <MetricCard title="Resultado neto" metric={data.resumen.netIncome} formatter={formatCurrency} icon={<TrendingUp className="h-4 w-4" />} />
                <MetricCard title="Nuevos prospectos" metric={data.resumen.newLeads} formatter={formatNumber} icon={<Inbox className="h-4 w-4" />} />
                <MetricCard title="Tratos ganados" metric={data.resumen.closedDeals} formatter={formatNumber} icon={<Target className="h-4 w-4" />} />
                <MetricCard title="Ticket promedio" metric={data.resumen.avgTicket} formatter={formatCurrency} icon={<DollarSign className="h-4 w-4" />} />
                <MetricCard title="Tasa de cierre" metric={data.resumen.winRate} formatter={formatPercent} icon={<Percent className="h-4 w-4" />} />
              </div>
            )}

            {tab === "ventas" && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard title="Tratos ganados" metric={data.ventas.closedDeals} formatter={formatNumber} />
                  <MetricCard title="Tratos perdidos" metric={data.ventas.lostDeals} formatter={formatNumber} />
                  <MetricCard title="Ingresos" metric={data.ventas.revenue} formatter={formatCurrency} />
                  <MetricCard title="Ticket promedio" metric={data.ventas.avgTicket} formatter={formatCurrency} />
                  <MetricCard title="Cotizaciones enviadas" metric={data.ventas.quotesSent} formatter={formatNumber} />
                  <MetricCard title="Cotizaciones aprobadas" metric={data.ventas.quotesApproved} formatter={formatNumber} />
                  <MetricCard title="Tasa de cierre" metric={data.ventas.winRate} formatter={formatPercent} />
                  <MetricCard title="Aprobación de cotización" metric={data.ventas.quoteApprovalRate} formatter={formatPercent} />
                </div>
              </div>
            )}

            {tab === "embudo" && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <h3 className="mb-4 text-sm font-semibold">Embudo del periodo</h3>
                  <FunnelChart data={data.embudo.stages} />
                </div>
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetricCard title="Prospecto → ganado" metric={data.embudo.leadToWon} formatter={formatPercent} />
                    <MetricCard title="Prospecto → cotizado" metric={data.embudo.leadToQuote} formatter={formatPercent} />
                    <MetricCard title="Cotizado → ganado" metric={data.embudo.quoteToWon} formatter={formatPercent} />
                  </div>
                  <div className="rounded-xl border bg-card p-4 shadow-sm">
                    <h3 className="mb-3 text-sm font-semibold">Motivos de pérdida</h3>
                    {data.embudo.lossByReason.length > 0 ? (
                      <HorizontalBarChart data={data.embudo.lossByReason.map((l) => ({ name: l.label, count: l.value }))} yKey="name" xKey="count" height={200} />
                    ) : (
                      <p className="text-sm text-muted-foreground">Sin pérdidas registradas en el periodo.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === "publicidad" && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard title="Inversión publicitaria" metric={data.publicidad.adSpend} formatter={formatCurrency} icon={<Megaphone className="h-4 w-4" />} />
                  <MetricCard title="ROAS" metric={data.publicidad.roas} formatter={(n) => `${n.toFixed(2)}x`} />
                  <MetricCard title="ROMI" metric={data.publicidad.romi} formatter={formatPercent} />
                  <MetricCard title="CAC" metric={data.publicidad.cac} formatter={formatCurrency} />
                </div>
                <p className="text-xs text-muted-foreground">
                  La inversión se calcula desde las campañas registradas. Conecta Meta Ads o registra campañas para ver ROAS/ROMI reales.
                </p>
              </div>
            )}

            {tab === "trafico" && (
              <div className="rounded-xl border border-dashed bg-card p-6 text-center">
                <p className="font-medium">Tráfico digital (GA4)</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Las sesiones de GA4 se leen desde la integración. Configura GA4 en Integraciones para verla aquí.
                </p>
                <Link
                  href="/settings/marketing"
                  className="mt-3 inline-flex h-8 items-center rounded-full border border-border-strong bg-transparent px-3 text-xs font-semibold text-foreground transition-colors hover:border-foreground"
                >
                  Configurar GA4
                </Link>
              </div>
            )}

            {tab === "adquisicion" && (
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <h3 className="mb-4 text-sm font-semibold">Primer toque por canal</h3>
                {data.adquisicion.hasData ? (
                  <HorizontalBarChart data={data.adquisicion.byChannel.map((c) => ({ name: c.name, count: c.count }))} yKey="name" xKey="count" height={Math.max(200, data.adquisicion.byChannel.length * 28)} />
                ) : (
                  <p className="text-sm text-muted-foreground">Sin eventos de atribución en el periodo. Los atributos de canal se registran al entrar el prospecto.</p>
                )}
              </div>
            )}

            {tab === "rentabilidad" && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <MetricCard title="Contribución" metric={data.rentabilidad.contribution} formatter={formatCurrency} />
                  <MetricCard title="Margen de contribución" metric={data.rentabilidad.contributionMargin} formatter={formatPercent} />
                  <MetricCard title="Ingresos de Marketplace" metric={data.rentabilidad.mlRevenue} formatter={formatCurrency} />
                </div>
                {!data.rentabilidad.hasCosts && (
                  <p className="text-xs text-muted-foreground">
                    Registra el costo de prestación de tus servicios para calcular contribución y margen reales. Hasta entonces no se muestra una rentabilidad estimada como si fuera real.
                  </p>
                )}
              </div>
            )}

            {tab === "experimentos" && (
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <h3 className="mb-4 text-sm font-semibold">Experimentos A/B ({data.experimentos.total})</h3>
                {data.experimentos.items.length > 0 ? (
                  <div className="space-y-2">
                    {data.experimentos.items.map((e) => (
                      <div key={e.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                        <span className="font-medium">{e.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${e.evidenceStatus === "concluyente" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {e.evidenceStatus === "concluyente" ? "Concluyente" : "Inconcluso"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Aún no hay experimentos. Documenta una hipótesis y compara variantes con evidencia, no con corazonadas.</p>
                )}
              </div>
            )}

            {tab === "operaciones" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <MetricCard title="Actividades registradas" metric={data.operaciones.activitiesLogged} formatter={formatNumber} />
                <MetricCard title="Tiempo de respuesta" metric={data.operaciones.responseTimeHours} formatter={(n) => `${n.toFixed(1)} h`} />
              </div>
            )}

            {tab === "calidad" && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard title="Contactos con canal" metric={data.calidad.contactsWithChannel} formatter={formatPercent} />
                <MetricCard title="Total de contactos" metric={data.calidad.totalContacts} formatter={formatNumber} />
                <MetricCard title="Con canal capturado" metric={data.calidad.contactsWithChannelCount} formatter={formatNumber} />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
