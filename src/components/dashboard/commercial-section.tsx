"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  RefreshCw, Target, DollarSign, Megaphone, Compass, Percent,
  FlaskConical, Headphones, ShieldCheck,
} from "lucide-react";
import { KpiCard, formatCurrency, formatNumber, formatPercent } from "./kpi-card";
import { FunnelChart, HorizontalBarChart } from "./charts";

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

function Subhead({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3 className="mb-3 mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
      {icon} {children}
    </h3>
  );
}

/** Sección "Control comercial" con las categorías del CRM, en línea dentro del dashboard. */
export function CommercialSection({ period }: { period: string }) {
  const [data, setData] = useState<CommercialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/commercial?period=${period}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData((await res.json()) as CommercialData);
    } catch {
      setError("No se pudieron cargar las métricas comerciales.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  return (
      <section>
      <div className="mb-3 flex justify-end">
        <div className="flex items-center gap-3">
          <Link href="/commercial" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
            Registrar datos comerciales
          </Link>
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div>}

      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Cargando métricas…
        </div>
      )}

        {data && !loading && (
          <div className="space-y-2">
          {/* Embudo */}
          <Subhead icon={<Target className="h-3.5 w-3.5" />}>Embudo de ventas</Subhead>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <h4 className="mb-4 text-sm font-semibold">Embudo del periodo</h4>
              <FunnelChart data={data.embudo.stages} />
            </div>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <MetricCard title="Prospecto → ganado" metric={data.embudo.leadToWon} formatter={formatPercent} />
                <MetricCard title="Prospecto → cotizado" metric={data.embudo.leadToQuote} formatter={formatPercent} />
                <MetricCard title="Cotizado → ganado" metric={data.embudo.quoteToWon} formatter={formatPercent} />
                <MetricCard title="Tasa de cierre" metric={data.resumen.winRate} formatter={formatPercent} />
              </div>
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <h4 className="mb-3 text-sm font-semibold">Motivos de pérdida</h4>
                {data.embudo.lossByReason.length > 0 ? (
                  <HorizontalBarChart data={data.embudo.lossByReason.map((l) => ({ name: l.label, count: l.value }))} yKey="name" xKey="count" height={200} />
                ) : (
                  <p className="text-sm text-muted-foreground">Sin pérdidas registradas en el periodo.</p>
                )}
              </div>
            </div>
          </div>

          {/* Publicidad */}
          <Subhead icon={<Megaphone className="h-3.5 w-3.5" />}>Publicidad</Subhead>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Presupuesto planeado" metric={data.publicidad.plannedBudget} formatter={formatCurrency} icon={<DollarSign className="h-4 w-4" />} />
            <MetricCard title="ROAS" metric={data.publicidad.roas} formatter={(n) => `${n.toFixed(2)}x`} />
            <MetricCard title="ROMI" metric={data.publicidad.romi} formatter={formatPercent} />
            <MetricCard title="CAC" metric={data.publicidad.cac} formatter={formatCurrency} />
          </div>
          <p className="text-xs text-muted-foreground">
            ROAS, ROMI y CAC requieren gasto real y atribución por campaña. El gasto real de las plataformas aparece en Marketing digital; el presupuesto planeado se captura en Registros comerciales.
          </p>

          {/* Adquisición */}
          <Subhead icon={<Compass className="h-3.5 w-3.5" />}>Adquisición</Subhead>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h4 className="mb-4 text-sm font-semibold">Primer toque por canal</h4>
            {data.adquisicion.hasData ? (
              <HorizontalBarChart data={data.adquisicion.byChannel.map((c) => ({ name: c.name, count: c.count }))} yKey="name" xKey="count" height={Math.max(200, data.adquisicion.byChannel.length * 28)} />
            ) : (
              <p className="text-sm text-muted-foreground">Sin eventos de atribución en el periodo.</p>
            )}
          </div>

          {/* Rentabilidad */}
          <Subhead icon={<Percent className="h-3.5 w-3.5" />}>Rentabilidad de prestación</Subhead>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard title="Contribución" metric={data.rentabilidad.contribution} formatter={formatCurrency} />
            <MetricCard title="Margen de contribución" metric={data.rentabilidad.contributionMargin} formatter={formatPercent} />
            <MetricCard title="Órdenes de Marketplace" metric={data.rentabilidad.mlOrders} formatter={formatNumber} />
          </div>
          <p className="text-xs text-muted-foreground">La contribución descuenta los costos de prestación; no descuenta publicidad porque falta gasto real atribuible.</p>
          {!data.rentabilidad.hasCosts && (
            <p className="text-xs text-muted-foreground">
              Registra el costo de prestación de tus servicios para calcular contribución y margen reales.
            </p>
          )}

          {/* Experimentos */}
          <Subhead icon={<FlaskConical className="h-3.5 w-3.5" />}>Experimentos A/B ({data.experimentos.total})</Subhead>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
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
              <p className="text-sm text-muted-foreground">Aún no hay experimentos. Documenta una hipótesis y compara variantes con evidencia.</p>
            )}
          </div>

          {/* Operaciones + Calidad */}
          <Subhead icon={<Headphones className="h-3.5 w-3.5" />}>Operaciones y calidad de datos</Subhead>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title="Actividades registradas" metric={data.operaciones.activitiesLogged} formatter={formatNumber} />
            <MetricCard title="Tiempo de respuesta" metric={data.operaciones.responseTimeHours} formatter={(n) => `${n.toFixed(1)} h`} />
            <MetricCard title="Contactos con canal" metric={data.calidad.contactsWithChannel} formatter={formatPercent} icon={<ShieldCheck className="h-4 w-4" />} />
            <MetricCard title="Con canal capturado" metric={data.calidad.contactsWithChannelCount} formatter={formatNumber} />
          </div>

          <p className="pt-2 text-xs text-muted-foreground">
            Métricas del periodo {data.period}.
          </p>
        </div>
      )}
    </section>
  );
}
