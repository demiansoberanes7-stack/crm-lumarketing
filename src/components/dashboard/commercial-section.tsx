"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw, Target, Percent,
} from "lucide-react";
import { KpiCard, formatPercent } from "./kpi-card";
import { FunnelChart, HorizontalBarChart } from "./charts";
import { CampaignExplorer } from "./campaign-explorer";
import { MetricBadge, type MetricOrigin } from "./metric-badge";

type MetricValue = { value: number | null; availability: "available" | "no_data" | "not_applicable" | "pending"; formatted: string | null };

interface CommercialData {
  period: string;
  currency: string;
  resumen: Record<string, MetricValue>;
  ventas: Record<string, MetricValue>;
  embudo: { stages: { stage: string; value: number }[]; leadToQualified: MetricValue; qualifiedToQuote: MetricValue; leadToWon: MetricValue; leadToQuote: MetricValue; quoteToWon: MetricValue; lossByReason: { key: string; label: string; value: number }[] };
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

function Subhead({ icon, origin, children }: { icon: React.ReactNode; origin?: MetricOrigin; children: React.ReactNode }) {
  return (
    <h3 className="mb-3 mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
      {icon} {children}
      {origin && <MetricBadge origin={origin} className="ml-1 normal-case tracking-normal" />}
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
          <Subhead icon={<Target className="h-3.5 w-3.5" />} origin="system">Embudo de ventas</Subhead>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="chart-card rounded-xl border p-4">
              <h4 className="mb-4 text-sm font-semibold">Embudo del periodo</h4>
              <FunnelChart data={data.embudo.stages} />
            </div>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <MetricCard title="Prospecto → calificado" metric={data.embudo.leadToQualified} formatter={formatPercent} />
                <MetricCard title="Calificado → cotizado" metric={data.embudo.qualifiedToQuote} formatter={formatPercent} />
                <MetricCard title="Prospecto → ganado" metric={data.embudo.leadToWon} formatter={formatPercent} />
                <MetricCard title="Prospecto → cotizado" metric={data.embudo.leadToQuote} formatter={formatPercent} />
                <MetricCard title="Cotizado → ganado" metric={data.embudo.quoteToWon} formatter={formatPercent} />
                <MetricCard title="Tasa de cierre" metric={data.resumen.winRate} formatter={formatPercent} />
              </div>
              <div className="chart-card rounded-xl border p-4">
                <h4 className="mb-3 text-sm font-semibold">Motivos de pérdida</h4>
                {data.embudo.lossByReason.length > 0 ? (
                  <HorizontalBarChart data={data.embudo.lossByReason.map((l) => ({ name: l.label, count: l.value }))} yKey="name" xKey="count" height={200} />
                ) : (
                  <p className="text-sm text-muted-foreground">Sin pérdidas registradas en el periodo.</p>
                )}
              </div>
            </div>
          </div>

          {/* Publicidad — métricas reales de Meta Ads por campaña */}
          <Subhead icon={<Target className="h-3.5 w-3.5" />} origin="external">Publicidad</Subhead>
          <CampaignExplorer period={period} />

          {/* Experimentos A/B — comparación de campañas */}
          <Subhead icon={<Percent className="h-3.5 w-3.5" />} origin="external">Experimentos A/B</Subhead>
          <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm">
            Compara tus campañas como un experimento A/B en el explorador de
            <span className="font-medium text-foreground"> Publicidad</span>: selecciona 2 o más campañas y revisa
            importe gastado, resultados, costo por resultado, impresiones, alcance, frecuencia, clics y CTR lado a lado
            para elegir ganadora. Las métricas se recalculan sobre la selección.
          </div>

          <p className="pt-2 text-xs text-muted-foreground">
            Métricas del periodo {data.period}.
          </p>
        </div>
      )}
    </section>
  );
}
