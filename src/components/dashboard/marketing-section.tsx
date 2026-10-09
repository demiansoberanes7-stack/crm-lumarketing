"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { MousePointerClick, RefreshCw, Eye, DollarSign, AlertCircle, Users, BarChart3, Megaphone } from "lucide-react";
import { KpiCard, formatNumber } from "./kpi-card";

interface AdsMetric {
  source: "google" | "meta" | "ga4";
  spend: number;
  impressions: number;
  clicks: number;
  currency: string;
}
interface AdsCampaign {
  id: string;
  name: string;
  source: "google" | "meta" | "ga4";
  spend: number;
  impressions: number;
  clicks: number;
  currency: string;
}
interface Ga4Data {
  sessions: number;
  users: number;
  newUsers: number;
  bounceRate: number;
  sources: { name: string; sessions: number }[];
  daily: { date: string; sessions: number }[];
}
interface AnalyticsData {
  metrics: AdsMetric[];
  campaigns: AdsCampaign[];
  chartData: { name: string; meta: number }[];
  connections: Record<"google" | "meta" | "ga4", { status: "disconnected" | "configured" | "connected" | "error"; message?: string }>;
  ga4: Ga4Data | null;
}

const connectionLabel: Record<string, string> = {
  disconnected: "Desconectado",
  configured: "Configurado; datos no disponibles",
  connected: "Conectado",
  error: "Error de conexión",
};

function fmt(n: number, currency?: string): string {
  if (currency) return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${currency}`;
  return n.toLocaleString("es-MX");
}

/** Sección "Marketing digital": integraciones GA4 + Meta Ads + conversión de pipeline. */
export function MarketingSection() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/analytics/dashboard")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
      if (!alive) return;
      if (d) setData(d as AnalyticsData);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Megaphone className="h-4 w-4" /> Marketing digital
        </h2>
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Cargando métricas de marketing…
        </div>
      </section>
    );
  }

  const ga4 = data?.ga4 ?? null;
  const metrics = data?.metrics ?? [];
  const totalSpend = metrics.reduce((s, m) => s + m.spend, 0);
  const totalClicks = metrics.reduce((s, m) => s + m.clicks, 0);
  const totalImpr = metrics.reduce((s, m) => s + m.impressions, 0);
  const anyConnected = data ? Object.values(data.connections).some((c) => c.status !== "disconnected") : false;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Megaphone className="h-4 w-4" /> Marketing digital
      </h2>

      {data && !anyConnected && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800 dark:text-amber-300">No hay integraciones conectadas</p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
              Ve a <Link href="/settings/marketing" className="font-medium underline">Configurar integraciones</Link> y conecta Google Ads, Meta Ads o GA4.
            </p>
          </div>
        </div>
      )}

      {/* GA4 */}
      {ga4 && (
        <div className="mb-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard title="Sesiones" value={formatNumber(ga4.sessions)} icon={<Eye />} />
            <KpiCard title="Usuarios" value={formatNumber(ga4.users)} icon={<Users />} />
            <KpiCard title="Usuarios nuevos" value={formatNumber(ga4.newUsers)} icon={<Users />} />
            <KpiCard title="Tasa de rebote" value={`${(ga4.bounceRate * 100).toFixed(1)}%`} icon={<AlertCircle />} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {ga4.sources.length > 0 && (
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <h3 className="mb-4 text-sm font-semibold">Canales de tráfico</h3>
                <div className="space-y-2">
                  {ga4.sources.map((s) => {
                    const max = ga4.sources[0]?.sessions || 1;
                    return (
                      <div key={s.name}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span>{s.name}</span>
                          <span className="font-bold">{fmt(s.sessions)}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-orange-500 transition-all duration-700" style={{ width: `${Math.min(100, (s.sessions / max) * 100)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {ga4.daily.length > 0 && (
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <h3 className="mb-4 text-sm font-semibold">Sesiones diarias (30 días)</h3>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ga4.daily.map((d) => ({ name: d.date.slice(6) + "/" + d.date.slice(4, 6), sesiones: d.sessions }))}>
                      <XAxis dataKey="name" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="sesiones" name="Sesiones" fill="#E87722" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ads */}
      {metrics.length > 0 && (
        <div className="mb-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <KpiCard title="Inversión total" value={fmt(totalSpend, "MXN")} icon={<DollarSign />} />
            <KpiCard title="Impresiones" value={fmt(totalImpr)} icon={<Eye />} />
            <KpiCard title="Clics" value={fmt(totalClicks)} icon={<MousePointerClick />} />
          </div>
          {data && data.campaigns.length > 0 && (
            <div className="overflow-hidden rounded-xl border bg-card p-4 shadow-sm">
              <h3 className="mb-4 text-sm font-semibold">Rendimiento por campaña</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="rounded-l-md px-4 py-2 font-medium">Campaña</th>
                      <th className="px-4 py-2 font-medium">Fuente</th>
                      <th className="px-4 py-2 text-right font-medium">Inversión</th>
                      <th className="px-4 py-2 text-right font-medium">Impresiones</th>
                      <th className="px-4 py-2 text-right font-medium">Clics</th>
                      <th className="rounded-r-md px-4 py-2 text-right font-medium">CPC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.campaigns.map((c) => (
                      <tr key={c.id} className="transition-colors hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{c.name}</td>
                        <td className="px-4 py-3 text-xs uppercase">{c.source}</td>
                        <td className="px-4 py-3 text-right">{fmt(c.spend, c.currency)}</td>
                        <td className="px-4 py-3 text-right">{fmt(c.impressions)}</td>
                        <td className="px-4 py-3 text-right">{fmt(c.clicks)}</td>
                        <td className="px-4 py-3 text-right">{c.clicks > 0 ? fmt(c.spend / c.clicks, c.currency) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {data && data.chartData.length > 0 && (
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4" /> Clics diarios — Meta Ads</h3>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.chartData}>
                    <XAxis dataKey="name" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="meta" name="Meta Ads" fill="#1877F2" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Estado de integraciones */}
      {data && (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {([["google", "Google Ads"], ["meta", "Meta Ads"], ["ga4", "Google Analytics 4"]] as const).map(([source, label]) => {
            const conn = data.connections[source];
            return (
              <div key={source} className="rounded-lg border bg-card px-3 py-2 text-sm">
                <span className="font-medium">{label}: </span>
                <span className={conn.status === "connected" ? "text-emerald-600" : "text-muted-foreground"}>{connectionLabel[conn.status]}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
