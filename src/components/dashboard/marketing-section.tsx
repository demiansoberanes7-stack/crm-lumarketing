"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { RefreshCw, Eye, AlertCircle, Users, Megaphone } from "lucide-react";
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
  cities?: { name: string; region: string; sessions: number }[];
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

/** Etiqueta de ventana para los rótulos del bloque GA4. */
function periodLabel(period: string): string {
  switch (period) {
    case "7d": return "7 días";
    case "90d": return "90 días";
    case "1y": return "1 año";
    default: return "30 días";
  }
}

/** Sección "Marketing digital": integraciones GA4 + Meta Ads + conversión de pipeline. */
export function MarketingSection({ period = "30d" }: { period?: string }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    fetch(`/api/analytics/dashboard?period=${encodeURIComponent(period)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!alive) return;
        setData(d as AnalyticsData);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [period]);

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
  // "configured" cuenta como conectado (credenciales guardadas); "error"/
  // "disconnected" no, para que el aviso aparezca cuando nada funciona.
  const anyConnected = data
    ? Object.values(data.connections).some((c) => c.status === "connected" || c.status === "configured")
    : false;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Megaphone className="h-4 w-4" /> Marketing digital
      </h2>

      {failed && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div className="text-sm">
            <p className="font-semibold text-red-800 dark:text-red-300">No se pudieron cargar las métricas de marketing</p>
            <p className="mt-0.5 text-xs text-red-700 dark:text-red-400">
              Revisa tu conexión o las integraciones en{" "}
              <Link href="/settings/marketing" className="font-medium underline">Configuración de marketing</Link>.
            </p>
          </div>
        </div>
      )}

      {!failed && data && !anyConnected && (
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
            <KpiCard title="Sesiones" value={formatNumber(ga4.sessions)} icon={<Eye />} origin="GA4" window={periodLabel(period)} />
            <KpiCard title="Usuarios" value={formatNumber(ga4.users)} icon={<Users />} origin="GA4" window={periodLabel(period)} />
            <KpiCard title="Usuarios nuevos" value={formatNumber(ga4.newUsers)} icon={<Users />} origin="GA4" window={periodLabel(period)} />
            <KpiCard title="Tasa de rebote" value={`${(ga4.bounceRate * 100).toFixed(1)}%`} icon={<AlertCircle />} origin="GA4" window={periodLabel(period)} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {ga4.sources.length > 0 && (
              <div className="chart-card rounded-xl border p-4">
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
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (s.sessions / max) * 100)}%`, background: "linear-gradient(90deg, var(--chart-3), var(--chart-3-end))", boxShadow: "0 0 12px var(--chart-3)" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {(ga4.cities?.length ?? 0) > 0 && (
              <div className="chart-card rounded-xl border p-4">
                <h3 className="mb-4 text-sm font-semibold">Tráfico por ciudad</h3>
                <div className="space-y-2">
                  {ga4.cities!.map((c) => {
                    const max = ga4.cities![0]?.sessions || 1;
                    return (
                      <div key={`${c.name}-${c.region}`}>
                        <div className="mb-1 flex justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate" title={`${c.name}${c.region ? `, ${c.region}` : ""}`}>
                            {c.name}
                            {c.region && (
                              <span className="text-muted-foreground"> · {c.region}</span>
                            )}
                          </span>
                          <span className="shrink-0 font-bold">{fmt(c.sessions)}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (c.sessions / max) * 100)}%`, background: "linear-gradient(90deg, var(--chart-5), var(--chart-5-end))", boxShadow: "0 0 12px var(--chart-5)" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {ga4.daily.length > 0 && (
              <div className="chart-card rounded-xl border p-4">
                <h3 className="mb-4 text-sm font-semibold">Sesiones diarias ({periodLabel(period)})</h3>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ga4.daily.map((d) => ({ name: d.date.slice(6) + "/" + d.date.slice(4, 6), sesiones: d.sessions }))}>
                      <defs><linearGradient id="dashboard-ga4-bar" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="var(--chart-3)" /><stop offset="100%" stopColor="var(--chart-3-end)" /></linearGradient></defs>
                      <XAxis dataKey="name" interval={5} stroke="#888" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="sesiones" name="Sesiones" fill="url(#dashboard-ga4-bar)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ads — las métricas de Meta Ads viven en Comercial · Publicidad (Campaign Explorer). */}

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
