"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart
} from "recharts";
import {
  MousePointerClick, RefreshCw, Eye, DollarSign, Plug, AlertCircle,
  Users, BarChart3, ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/* ─── Types ─── */
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

interface PipelineMetric {
  leads: number;
  quotes: number;
  won: number;
  conversionRate: number;
}

interface Ga4Data {
  sessions: number;
  users: number;
  newUsers: number;
  bounceRate: number;
  sources: { name: string; sessions: number }[];
  daily: { date: string; sessions: number }[];
}

interface DashboardData {
  metrics: AdsMetric[];
  campaigns: AdsCampaign[];
  chartData: { name: string; meta: number }[];
  connections: Record<"google" | "meta" | "ga4", { status: "disconnected" | "configured" | "connected" | "error"; message?: string }>;
  ga4: Ga4Data | null;
}

const connectionLabel = {
  disconnected: "Desconectado",
  configured: "Configurado; datos no disponibles",
  connected: "Conectado",
  error: "Error de conexión",
} as const;

/* ─── Helpers ─── */
function fmt(n: number, currency?: string): string {
  if (currency) return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${currency}`;
  return n.toLocaleString("es-MX");
}

/* ─── Source badge ─── */
function SourceBadge({ source }: { source: "google" | "meta" | "ga4" }) {
  if (source === "google") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21.35,11.1H12.18V13.83H18.69C18.36,17.64 15.19,19.27 12.19,19.27C8.36,19.27 5,16.25 5,12C5,7.9 8.2,4.73 12.2,4.73C15.29,4.73 17.1,6.7 17.1,6.7L19,4.72C19,4.72 16.56,2 12.1,2C6.42,2 2.03,6.8 2.03,12C2.03,17.05 6.16,22 12.25,22C17.6,22 21.5,18.33 21.5,12.91C21.5,11.76 21.35,11.1 21.35,11.1Z" />
      </svg>
      Google Ads
    </span>
  );
  if (source === "meta") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02Z" />
      </svg>
      Meta Ads
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300">
      <BarChart3 className="h-2.5 w-2.5" /> GA4
    </span>
  );
}

/* ─── Main ─── */
export function AnalyticsClient() {
  const router = useRouter();
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [pipeData, setPipeData] = useState<PipelineMetric | null>(null);
  const [pipeState, setPipeState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingDash, setLoadingDash] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/dashboard")
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setDashData(d as DashboardData); })
      .catch(() => null)
      .finally(() => setLoadingDash(false));
  }, []);

  useEffect(() => {
    fetch("/api/pipeline/stats")
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then(d => { setPipeData(d as PipelineMetric); setPipeState("ready"); })
      .catch(() => setPipeState("error"));
  }, []);

  const ga4 = dashData?.ga4 ?? null;
  const anyConnected = dashData
    ? Object.values(dashData.connections).some(c => c.status !== "disconnected")
    : false;

  // Totals from real data
  const totalSpend = dashData?.metrics.reduce((s, m) => s + m.spend, 0) ?? 0;
  const totalImpr = dashData?.metrics.reduce((s, m) => s + m.impressions, 0) ?? 0;
  const totalClicks = dashData?.metrics.reduce((s, m) => s + m.clicks, 0) ?? 0;

  return (
    <div className="flex h-full flex-col bg-background/50 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Marketing Hub</h1>
          <p className="text-sm text-muted-foreground">
            Métricas reales de Google Ads, Meta Ads y Google Analytics 4
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push("/settings/marketing")}>
          <Plug className="mr-2 h-4 w-4" /> Configurar integraciones
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </header>

      <main className="flex-1 overflow-auto p-6">
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* Connection banner */}
          {dashData && !anyConnected && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-amber-500" />
              <div>
                <p className="text-sm font-semibold text-amber-800">No hay integraciones conectadas</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Ve a{" "}
                  <Link href="/settings/marketing" className="underline font-medium">
                    Configurar integraciones
                  </Link>{" "}
                  y conecta Google Ads, Meta Ads o GA4 para ver métricas reales.
                </p>
              </div>
            </div>
          )}

          {dashData && (
            <div className="grid gap-2 sm:grid-cols-3">
              {([
                ["google", "Google Ads"],
                ["meta", "Meta Ads"],
                ["ga4", "Google Analytics 4"],
              ] as const).map(([source, label]) => {
                const connection = dashData.connections[source];
                const connected = connection.status === "connected";
                return (
                  <div key={source} className="rounded-lg border bg-card px-3 py-2 text-sm">
                    <span className="font-medium">{label}: </span>
                    <span className={connected ? "text-emerald-600" : "text-muted-foreground"}>
                      {connectionLabel[connection.status]}
                    </span>
                    {connection.message && <p className="mt-1 text-xs text-muted-foreground">{connection.message}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {loadingDash && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-6">
              <RefreshCw className="h-4 w-4 animate-spin" /> Cargando métricas…
            </div>
          )}

          {/* ── GA4: lectura real (sesiones, usuarios, canales) ── */}
          {!loadingDash && ga4 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <SourceBadge source="ga4" />
                <span className="text-xs text-muted-foreground">· últimos 30 días</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Eye className="h-3.5 w-3.5 text-orange-500" /> Sesiones
                  </div>
                  <div className="mt-1 text-xl font-bold">{fmt(ga4.sessions)}</div>
                </div>
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5 text-blue-500" /> Usuarios
                  </div>
                  <div className="mt-1 text-xl font-bold">{fmt(ga4.users)}</div>
                </div>
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5 text-emerald-500" /> Usuarios nuevos
                  </div>
                  <div className="mt-1 text-xl font-bold">{fmt(ga4.newUsers)}</div>
                </div>
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500" /> Tasa de rebote
                  </div>
                  <div className="mt-1 text-xl font-bold">
                    {(ga4.bounceRate * 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {/* Canales de tráfico */}
                {ga4.sources.length > 0 && (
                  <div className="rounded-xl border bg-card p-4 shadow-sm">
                    <h3 className="mb-4 text-sm font-semibold">Canales de tráfico</h3>
                    <div className="space-y-2">
                      {ga4.sources.map(s => {
                        const max = ga4.sources[0]?.sessions || 1;
                        return (
                          <div key={s.name}>
                            <div className="flex justify-between text-sm mb-1">
                              <span>{s.name}</span>
                              <span className="font-bold">{fmt(s.sessions)}</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-orange-500 transition-all duration-700"
                                style={{ width: `${Math.min(100, (s.sessions / max) * 100)}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Serie diaria de sesiones */}
                {ga4.daily.length > 0 && (
                  <div className="rounded-xl border bg-card p-4 shadow-sm">
                    <h3 className="mb-4 text-sm font-semibold">Sesiones diarias (últimos 30 días)</h3>
                    <div className="h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={ga4.daily.map(d => ({ name: d.date.slice(6) + "/" + d.date.slice(4, 6), sesiones: d.sessions }))}>
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

          {/* ── Ads (Meta con lectura real; Google Ads aún sin lectura) ── */}
          {!loadingDash && dashData && dashData.metrics.length > 0 && (
            <>
              {dashData.metrics.map(m => (
                <div key={m.source} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <SourceBadge source={m.source} />
                    <span className="text-xs text-muted-foreground">· datos de los últimos 30 días</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="rounded-xl border bg-card p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <DollarSign className="h-3.5 w-3.5 text-emerald-500" /> Inversión
                      </div>
                      <div className="mt-1 text-xl font-bold">{fmt(m.spend, m.currency)}</div>
                    </div>
                    <div className="rounded-xl border bg-card p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Eye className="h-3.5 w-3.5 text-blue-500" /> Impresiones
                      </div>
                      <div className="mt-1 text-xl font-bold">{fmt(m.impressions)}</div>
                    </div>
                    <div className="rounded-xl border bg-card p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <MousePointerClick className="h-3.5 w-3.5 text-orange-500" /> Clics
                      </div>
                      <div className="mt-1 text-xl font-bold">{fmt(m.clicks)}</div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Totals row */}
              <div className="rounded-xl border bg-primary/5 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Totales combinados (todas las fuentes)
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Inversión Total", value: fmt(totalSpend, "MXN"), icon: DollarSign, color: "text-emerald-500" },
                    { label: "Impresiones", value: fmt(totalImpr), icon: Eye, color: "text-blue-500" },
                    { label: "Clics Totales", value: fmt(totalClicks), icon: MousePointerClick, color: "text-orange-500" },
                  ].map(({ label, value, icon: Icon, color }) => (
                    <div key={label} className="flex items-center gap-3">
                      <Icon className={`h-5 w-5 ${color}`} />
                      <div>
                        <p className="text-lg font-bold">{value}</p>
                        <p className="text-xs text-muted-foreground">{label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Campaigns Table */}
              {dashData.campaigns.length > 0 && (
                <div className="rounded-xl border bg-card p-4 shadow-sm overflow-hidden">
                  <h3 className="mb-4 text-sm font-semibold">Rendimiento por Campaña</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="text-xs text-muted-foreground bg-muted/50">
                        <tr>
                          <th className="px-4 py-2 font-medium rounded-l-md">Campaña</th>
                          <th className="px-4 py-2 font-medium">Fuente</th>
                          <th className="px-4 py-2 font-medium text-right">Inversión</th>
                          <th className="px-4 py-2 font-medium text-right">Impresiones</th>
                          <th className="px-4 py-2 font-medium text-right">Clics</th>
                          <th className="px-4 py-2 font-medium text-right rounded-r-md">CPC Prom.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {dashData.campaigns.map(camp => (
                          <tr key={camp.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3 font-medium">{camp.name}</td>
                            <td className="px-4 py-3"><SourceBadge source={camp.source} /></td>
                            <td className="px-4 py-3 text-right">{fmt(camp.spend, camp.currency)}</td>
                            <td className="px-4 py-3 text-right">{fmt(camp.impressions)}</td>
                            <td className="px-4 py-3 text-right">{fmt(camp.clicks)}</td>
                            <td className="px-4 py-3 text-right">{camp.clicks > 0 ? fmt(camp.spend / camp.clicks, camp.currency) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Serie diaria real de Meta; no se distribuyen totales artificialmente. */}
              {dashData.chartData.length > 0 && (
                <div className="rounded-xl border bg-card p-4 shadow-sm">
                  <h3 className="mb-4 text-sm font-semibold">Clics diarios — Meta Ads (últimos 30 días)</h3>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dashData.chartData}>
                        <XAxis dataKey="name" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="meta" name="Meta Ads" fill="#1877F2" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Sin ninguna fuente con datos: estado vacío honesto */}
          {!loadingDash && dashData && dashData.metrics.length === 0 && !ga4 && anyConnected && (
            <div className="rounded-xl border border-dashed bg-card p-6 text-center">
              <p className="font-medium">No hay métricas reales disponibles</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Revisa el estado de cada integración o conecta una fuente con datos de campañas.
              </p>
            </div>
          )}

          {/* Pipeline metrics — always from DB */}
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-sm font-semibold">Conversión del Pipeline</h3>
              <span className="text-xs text-muted-foreground">(datos en tiempo real del CRM)</span>
            </div>
            {pipeData ? (
              <div className="space-y-3 max-w-xs">
                {[
                  { label: "Leads Captados", value: pipeData.leads, total: pipeData.leads, color: "bg-blue-500" },
                  { label: "Cotizados", value: pipeData.quotes, total: pipeData.leads, color: "bg-orange-500" },
                  { label: "Ganados", value: pipeData.won, total: pipeData.leads, color: "bg-emerald-500" },
                ].map(({ label, value, total, color }) => (
                  <div key={label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{label}</span>
                      <span className="font-bold">{value}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color} transition-all duration-700`}
                        style={{ width: total > 0 ? `${Math.min(100, (value / total) * 100)}%` : "0%" }}
                      />
                    </div>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  Tasa de conversión global: {pipeData.conversionRate.toFixed(1)}%
                </p>
              </div>
            ) : pipeState === "error" ? (
              <p className="text-sm text-muted-foreground">
                No se pudieron cargar las métricas del pipeline. Recarga la página para reintentar.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Cargando datos del pipeline…</p>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
