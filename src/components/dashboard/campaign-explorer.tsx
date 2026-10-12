"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, CheckCircle2, CircleAlert, Eye, Film, MousePointerClick, Percent,
  PlayCircle, RefreshCw, TrendingUp, Users, DollarSign,
} from "lucide-react";
import { KpiCard, formatCurrency, formatNumber, formatPercent } from "./kpi-card";
import { HorizontalBarChart } from "./charts";

/**
 * Campaign Explorer: las métricas que entrega Meta Ads por campaña. Los
 * componentes vienen de `/api/ads/campaigns` (persistidos por el poller); las
 * razones (CTR, frecuencia, costo por resultado) se recalculan aquí sobre la
 * selección para que agreguen correctamente.
 *
 * Métricas mostradas (las que Meta entrega por campaña): Importe gastado,
 * Resultados, Costo por resultado, Impresiones, Alcance, Frecuencia,
 * Clics (todos), CTR, Reproducciones, Espectadores, ThruPlays y Reproducciones
 * de video continuas de 2 segundos.
 */

interface CampaignRow {
  id: string;
  externalId: string;
  name: string;
  objective: string | null;
  status: string | null;
  currency: string;
  spendCents: number;
  impressions: number;
  reach: number;
  clicks: number;
  uniqueClicks: number;
  conversions: number;
  conversionValueCents: number;
  videoViews: number;
  thruplay: number;
  videoPlays: number;
  uniqueVideoViews: number;
  videoPlays2s: number;
  avgWatchTimeMs: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP100: number;
}

interface Aggregates {
  spendCents: number;
  conversions: number;
  costPerResultCents: number | null;
  impressions: number;
  reach: number;
  frequency: number | null;
  clicks: number;
  ctr: number | null;
  videoPlays: number;
  uniqueVideoViews: number;
  thruplay: number;
  videoPlays2s: number;
}

interface ExplorerData {
  campaigns: CampaignRow[];
  connection: { status: string; message?: string };
  currency: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Suma componentes de la selección y recalcula las razones. */
function aggregate(rows: CampaignRow[]): Aggregates {
  let spendCents = 0, impressions = 0, reach = 0, clicks = 0, conversions = 0;
  let videoPlays = 0, uniqueVideoViews = 0, videoPlays2s = 0, thruplay = 0;
  for (const r of rows) {
    spendCents += r.spendCents;
    impressions += r.impressions;
    reach += r.reach;
    clicks += r.clicks;
    conversions += r.conversions;
    videoPlays += r.videoPlays;
    uniqueVideoViews += r.uniqueVideoViews;
    videoPlays2s += r.videoPlays2s;
    thruplay += r.thruplay;
  }
  const ctr = impressions > 0 ? round2((clicks / impressions) * 100) : null;
  const frequency = reach > 0 ? round2(impressions / reach) : null;
  const costPerResultCents = conversions > 0 ? Math.round(spendCents / conversions) : null;
  return {
    spendCents, conversions, costPerResultCents, impressions, reach, frequency,
    clicks, ctr, videoPlays, uniqueVideoViews, thruplay, videoPlays2s,
  };
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activa", PAUSED: "Pausada", DELETED: "Eliminada", ARCHIVED: "Archivada",
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const active = status === "ACTIVE";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
      {active ? <CheckCircle2 className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Explorador de campañas de Meta Ads con selección múltiple. */
export function CampaignExplorer({ period }: { period: string }) {
  const [data, setData] = useState<ExplorerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ads/campaigns?period=${period}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as ExplorerData & { campaigns: CampaignRow[] };
      setData(json);
      // Por defecto seleccionar todas las campañas.
      setSelected(new Set(json.campaigns.map((c) => c.externalId)));
    } catch {
      setData({ campaigns: [], connection: { status: "error", message: "No se pudieron cargar las campañas." }, currency: "MXN" });
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const campaigns = useMemo(() => data?.campaigns ?? [], [data]);
  const allIds = useMemo(() => campaigns.map((c) => c.externalId), [campaigns]);
  const allSelected = allIds.length > 0 && selected.size === allIds.length;

  const selectedRows = useMemo(
    () => campaigns.filter((c) => selected.has(c.externalId)),
    [campaigns, selected]
  );
  const agg = useMemo(() => aggregate(selectedRows), [selectedRows]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allIds));
  };

  const spendByCampaign = useMemo(
    () => campaigns.map((c) => ({ name: c.name, count: Math.round(c.spendCents / 100) })),
    [campaigns]
  );

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" /> Cargando campañas de Meta Ads…
      </div>
    );
  }

  const notConfigured = data?.connection.status === "disconnected";
  const isError = data?.connection.status === "error";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4" /> Campañas — Meta Ads
        </h4>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>

      {notConfigured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {data?.connection.message ?? "Conecta Meta Ads en Conexiones para ver tus campañas."}
        </div>
      )}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {data?.connection.message ?? "Error al consultar Meta Ads."}
        </div>
      )}

      {!notConfigured && !isError && campaigns.length === 0 && (
        <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          Conectado, pero sin campañas con gasto en el periodo. Tus métricas aparecerán aquí en cuanto Meta registre actividad.
        </div>
      )}

      {campaigns.length > 0 && (
        <>
          {/* Selector + tarjetas de la selección */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded" />
              <span className="font-medium">Seleccionar todas</span>
            </label>
            <span className="text-xs text-muted-foreground">
              {selected.size} de {allIds.length} campaña(es) · métricas de abajo recalculadas sobre la selección
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <KpiCard title="Importe gastado" value={formatCurrency(agg.spendCents)} icon={<DollarSign />} subtitle={`${selectedRows.length} campaña(s)`} />
            <KpiCard title="Resultados" value={formatNumber(agg.conversions)} icon={<CheckCircle2 />} />
            <KpiCard title="Costo por resultado" value={agg.costPerResultCents != null ? formatCurrency(agg.costPerResultCents) : "N/D"} icon={<DollarSign />} subtitle="gasto por resultado" />
            <KpiCard title="Impresiones" value={formatNumber(agg.impressions)} icon={<Eye />} />
            <KpiCard title="Alcance" value={formatNumber(agg.reach)} icon={<Users />} />
            <KpiCard title="Frecuencia" value={agg.frequency != null ? agg.frequency.toFixed(2) : "N/D"} icon={<TrendingUp />} subtitle="impresiones / alcance" />
            <KpiCard title="Clics (todos)" value={formatNumber(agg.clicks)} icon={<MousePointerClick />} />
            <KpiCard title="CTR" value={formatPercent(agg.ctr)} icon={<Percent />} subtitle={agg.ctr == null ? "Sin impresiones" : `${formatNumber(agg.clicks)} clics`} />
            <KpiCard title="Reproducciones" value={formatNumber(agg.videoPlays)} icon={<Film />} subtitle="video plays" />
            <KpiCard title="Espectadores" value={formatNumber(agg.uniqueVideoViews)} icon={<Eye />} subtitle="visualizadores únicos" />
            <KpiCard title="ThruPlays" value={formatNumber(agg.thruplay)} icon={<PlayCircle />} />
            <KpiCard title="Reproducciones video 2s" value={formatNumber(agg.videoPlays2s)} icon={<Film />} subtitle="2 s continuos" />
          </div>

          {/* Gasto por campaña */}
          {spendByCampaign.some((c) => c.count > 0) && (
            <div className="chart-card rounded-xl border p-4">
              <h4 className="mb-3 text-sm font-semibold">Gasto por campaña (periodo)</h4>
              <HorizontalBarChart data={spendByCampaign} yKey="name" xKey="count" height={Math.max(200, spendByCampaign.length * 28)} />
            </div>
          )}

          {/* Tabla por campaña */}
          <div className="chart-card overflow-hidden rounded-xl border p-4">
            <h4 className="mb-3 text-sm font-semibold">Detalle por campaña</h4>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1300px] text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium"></th>
                    <th className="px-3 py-2 font-medium">Campaña</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                    <th className="px-3 py-2 text-right font-medium">Importe</th>
                    <th className="px-3 py-2 text-right font-medium">Resultados</th>
                    <th className="px-3 py-2 text-right font-medium">Costo/resultado</th>
                    <th className="px-3 py-2 text-right font-medium">Impresiones</th>
                    <th className="px-3 py-2 text-right font-medium">Alcance</th>
                    <th className="px-3 py-2 text-right font-medium">Frec.</th>
                    <th className="px-3 py-2 text-right font-medium">Clics</th>
                    <th className="px-3 py-2 text-right font-medium">CTR</th>
                    <th className="px-3 py-2 text-right font-medium">Reproducc.</th>
                    <th className="px-3 py-2 text-right font-medium">Espectadores</th>
                    <th className="px-3 py-2 text-right font-medium">ThruPlays</th>
                    <th className="px-3 py-2 text-right font-medium">Reproducc. 2s</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {campaigns.map((c) => {
                    const m = aggregate([c]);
                    const isSel = selected.has(c.externalId);
                    return (
                      <tr key={c.externalId} className={`transition-colors ${isSel ? "bg-primary/5" : "opacity-60"} hover:bg-muted/30`}>
                        <td className="px-2 py-2">
                          <input type="checkbox" checked={isSel} onChange={() => toggle(c.externalId)} className="h-4 w-4 rounded" />
                        </td>
                        <td className="max-w-[220px] px-3 py-2">
                          <div className="truncate font-medium" title={c.name}>{c.name}</div>
                          {c.objective && <div className="truncate text-[10px] uppercase text-muted-foreground">{c.objective}</div>}
                        </td>
                        <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(c.spendCents)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.conversions)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.costPerResultCents != null ? formatCurrency(m.costPerResultCents) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.impressions)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.reach)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.frequency != null ? m.frequency.toFixed(2) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.clicks)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatPercent(m.ctr)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.videoPlays)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.uniqueVideoViews)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.thruplay)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(c.videoPlays2s)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Métricas reales de Meta Ads: importe gastado, resultados, costo por resultado, impresiones, alcance, frecuencia, clics, CTR, reproducciones, espectadores, ThruPlays y reproducciones de video continuas de 2 segundos. Selecciona campañas para agregar sus métricas. El gasto es el que registra Meta; no hay presupuesto planeado.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
