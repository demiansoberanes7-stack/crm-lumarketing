"use client";

import { useState, useEffect } from "react";
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, Legend
} from "recharts";
import {
  Activity, MousePointerClick, RefreshCw, Eye, DollarSign, Plug, Save,
  Info, AlertCircle, CheckCircle2, BarChart3, Megaphone, Globe
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* ─── Types ─── */
interface Integration {
  connected: boolean;
  credentials: Record<string, string>;
}

interface AdsMetric {
  source: "google" | "meta";
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  currency: string;
}

interface PipelineMetric {
  leads: number;
  quotes: number;
  won: number;
  conversionRate: number;
}

interface DashboardData {
  metrics: AdsMetric[];
  pipelineMetric: PipelineMetric;
  chartData: { name: string; google: number; meta: number }[];
}

/* ─── Helpers ─── */
function fmt(n: number, currency?: string): string {
  if (currency) return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${currency}`;
  return n.toLocaleString("es-MX");
}

/* ─── Field hint component ─── */
function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-[11px] text-muted-foreground leading-snug flex items-start gap-1">
      <Info className="h-3 w-3 mt-0.5 shrink-0 text-blue-400" />
      {children}
    </p>
  );
}

/* ─── Empty state when no integration connected ─── */
function NoDataCard({ title, icon: Icon, color }: { title: string; icon: React.ElementType; color: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-card p-6 text-center">
      <Icon className={`mx-auto mb-2 h-8 w-8 ${color} opacity-40`} />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground/60">
        Conecta la integración en la pestaña <strong>Integraciones</strong> para ver datos reales.
      </p>
    </div>
  );
}

/* ─── Source badge ─── */
function SourceBadge({ source }: { source: "google" | "meta" | "ga4" }) {
  if (source === "google") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21.35,11.1H12.18V13.83H18.69C18.36,17.64 15.19,19.27 12.19,19.27C8.36,19.27 5,16.25 5,12C5,7.9 8.2,4.73 12.2,4.73C15.29,4.73 17.1,6.7 17.1,6.7L19,4.72C19,4.72 16.56,2 12.1,2C6.42,2 2.03,6.8 2.03,12C2.03,17.05 6.16,22 12.25,22C17.6,22 21.5,18.33 21.5,12.91C21.5,11.76 21.35,11.1 21.35,11.1Z" />
      </svg>
      Google Ads
    </span>
  );
  if (source === "meta") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02Z" />
      </svg>
      Meta Ads
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
      <BarChart3 className="h-2.5 w-2.5" /> GA4
    </span>
  );
}

/* ─── Main ─── */
export function AnalyticsClient() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "settings">("dashboard");
  const [googleAdsCreds, setGoogleAdsCreds] = useState({ clientId: "", clientSecret: "", developerToken: "", customerId: "" });
  const [metaAdsCreds, setMetaAdsCreds] = useState({ accessToken: "", adAccountId: "" });
  const [ga4Creds, setGa4Creds] = useState({ propertyId: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Connection status derived from creds
  const googleConnected = !!(googleAdsCreds.customerId && googleAdsCreds.developerToken);
  const metaConnected = !!(metaAdsCreds.accessToken && metaAdsCreds.adAccountId);
  const ga4Connected = !!ga4Creds.propertyId;
  const anyConnected = googleConnected || metaConnected || ga4Connected;

  // Real dashboard data from API
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [pipeData, setPipeData] = useState<PipelineMetric | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);

  useEffect(() => {
    async function load() {
      const [gAds, mAds, ga4] = await Promise.all([
        fetch("/api/integrations/google_ads").then(r => r.json()).catch(() => ({})),
        fetch("/api/integrations/meta_ads").then(r => r.json()).catch(() => ({})),
        fetch("/api/integrations/ga4").then(r => r.json()).catch(() => ({})),
      ]);
      if (gAds?.credentials) setGoogleAdsCreds(gAds.credentials);
      if (mAds?.credentials) setMetaAdsCreds(mAds.credentials);
      if (ga4?.credentials) setGa4Creds(ga4.credentials);
    }
    void load();
  }, []);

  // Load pipeline stats (always real from DB)
  useEffect(() => {
    fetch("/api/pipeline/stats").then(r => r.ok ? r.json() : null).then(d => {
      if (d) setPipeData(d as PipelineMetric);
    }).catch(() => null);
  }, []);

  // Load ads dashboard if connected
  useEffect(() => {
    if (!anyConnected) return;
    setLoadingDash(true);
    fetch("/api/analytics/dashboard").then(r => r.ok ? r.json() : null).then(d => {
      if (d) setDashData(d as DashboardData);
    }).catch(() => null).finally(() => setLoadingDash(false));
  }, [anyConnected]);

  async function saveIntegration(provider: string, creds: unknown) {
    await fetch(`/api/integrations/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    await Promise.all([
      saveIntegration("google_ads", googleAdsCreds),
      saveIntegration("meta_ads", metaAdsCreds),
      saveIntegration("ga4", ga4Creds),
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  // Totals from real data
  const totalSpend = dashData?.metrics.reduce((s, m) => s + m.spend, 0) ?? 0;
  const totalImpr = dashData?.metrics.reduce((s, m) => s + m.impressions, 0) ?? 0;
  const totalClicks = dashData?.metrics.reduce((s, m) => s + m.clicks, 0) ?? 0;
  const totalLeads = dashData?.metrics.reduce((s, m) => s + m.leads, 0) ?? 0;
  const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0;

  return (
    <div className="flex h-full flex-col bg-background/50 text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Marketing Hub</h1>
          <p className="text-sm text-muted-foreground">
            Métricas reales de Google Ads, Meta Ads y Google Analytics 4
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={activeTab === "dashboard" ? "default" : "outline"} onClick={() => setActiveTab("dashboard")}>
            <BarChart3 className="mr-2 h-4 w-4" /> Dashboard
          </Button>
          <Button variant={activeTab === "settings" ? "default" : "outline"} onClick={() => setActiveTab("settings")}>
            <Plug className="mr-2 h-4 w-4" /> Integraciones
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        {activeTab === "dashboard" ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Connection banner */}
            {!anyConnected && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-amber-500" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">No hay integraciones conectadas</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Ve a <button onClick={() => setActiveTab("settings")} className="underline font-medium">Integraciones</button> y conecta Google Ads, Meta Ads o GA4 para ver métricas reales.
                  </p>
                </div>
              </div>
            )}

            {/* KPI Cards — only show when connected */}
            {anyConnected && (
              <>
                {loadingDash && (
                  <div className="text-center text-sm text-muted-foreground py-6">Cargando métricas…</div>
                )}

                {!loadingDash && dashData && (
                  <>
                    {/* Per-source section */}
                    {dashData.metrics.map(m => (
                      <div key={m.source} className="space-y-3">
                        <div className="flex items-center gap-2">
                          <SourceBadge source={m.source} />
                          <span className="text-xs text-muted-foreground">· datos de los últimos 7 días</span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                          <div className="rounded-xl border bg-card p-4 shadow-sm">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <RefreshCw className="h-3.5 w-3.5 text-purple-500" /> CPL
                            </div>
                            <div className="mt-1 text-xl font-bold">
                              {m.leads > 0 ? fmt(m.spend / m.leads, m.currency) : "—"}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Totals row */}
                    <div className="rounded-xl border bg-primary/5 p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Totales combinados (todas las fuentes)
                      </p>
                      <div className="grid gap-3 sm:grid-cols-4">
                        {[
                          { label: "Inversión Total", value: fmt(totalSpend, "MXN"), icon: DollarSign, color: "text-emerald-500" },
                          { label: "Impresiones", value: fmt(totalImpr), icon: Eye, color: "text-blue-500" },
                          { label: "Clics Totales", value: fmt(totalClicks), icon: MousePointerClick, color: "text-orange-500" },
                          { label: "CPL Promedio", value: fmt(cpl, "MXN"), icon: RefreshCw, color: "text-purple-500" },
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

                    {/* Chart: Google vs Meta */}
                    {dashData.chartData.length > 0 && (
                      <div className="rounded-xl border bg-card p-4 shadow-sm">
                        <h3 className="mb-4 text-sm font-semibold">Clics por día — Google vs Meta</h3>
                        <div className="h-[260px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dashData.chartData}>
                              <XAxis dataKey="name" stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                              <YAxis stroke="#888" fontSize={11} tickLine={false} axisLine={false} />
                              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                              <Legend />
                              <Bar dataKey="google" name="Google Ads" fill="#4285F4" radius={[4, 4, 0, 0]} />
                              <Bar dataKey="meta" name="Meta Ads" fill="#1877F2" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
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
              ) : (
                <p className="text-sm text-muted-foreground">Cargando datos del pipeline…</p>
              )}
            </div>

          </div>
        ) : (
          /* ─── SETTINGS TAB ─── */
          <div className="mx-auto max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Integraciones de Ads & Analytics</h2>
                <p className="text-sm text-muted-foreground">Conecta tus cuentas para importar métricas reales al Dashboard.</p>
              </div>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saved ? (
                  <><CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" /> Guardado</>
                ) : saving ? (
                  <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Guardando…</>
                ) : (
                  <><Save className="mr-2 h-4 w-4" /> Guardar Cambios</>
                )}
              </Button>
            </div>

            {/* ── Google Ads ── */}
            <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-blue-600">
                  <span className="rounded-md bg-blue-100 p-1">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M21.35,11.1H12.18V13.83H18.69C18.36,17.64 15.19,19.27 12.19,19.27C8.36,19.27 5,16.25 5,12C5,7.9 8.2,4.73 12.2,4.73C15.29,4.73 17.1,6.7 17.1,6.7L19,4.72C19,4.72 16.56,2 12.1,2C6.42,2 2.03,6.8 2.03,12C2.03,17.05 6.16,22 12.25,22C17.6,22 21.5,18.33 21.5,12.91C21.5,11.76 21.35,11.1 21.35,11.1Z" />
                    </svg>
                  </span>
                  Google Ads
                </h3>
                {googleConnected && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Customer ID</Label>
                  <Input
                    placeholder="123-456-7890"
                    value={googleAdsCreds.customerId}
                    onChange={e => setGoogleAdsCreds(c => ({ ...c, customerId: e.target.value }))}
                  />
                  <FieldHint>
                    En Google Ads → haz clic en el icono de llave inglesa (⚙️) → Configuración de la cuenta. Aparece como <strong>"ID de cliente"</strong> en la esquina superior izquierda.
                  </FieldHint>
                </div>
                <div>
                  <Label>Developer Token</Label>
                  <Input
                    type="password"
                    placeholder="Token de Google Ads API"
                    value={googleAdsCreds.developerToken}
                    onChange={e => setGoogleAdsCreds(c => ({ ...c, developerToken: e.target.value }))}
                  />
                  <FieldHint>
                    En Google Ads API Center (<code>ads.google.com/aw/apicenter</code>). Necesitas cuenta de administrador (MCC).
                  </FieldHint>
                </div>
                <div>
                  <Label>Client ID (OAuth)</Label>
                  <Input
                    placeholder="OAuth Client ID"
                    value={googleAdsCreds.clientId}
                    onChange={e => setGoogleAdsCreds(c => ({ ...c, clientId: e.target.value }))}
                  />
                  <FieldHint>
                    En Google Cloud Console → APIs & Services → Credentials → <strong>Create OAuth 2.0 Client ID</strong>. Activa la API de Google Ads primero.
                  </FieldHint>
                </div>
                <div>
                  <Label>Client Secret (OAuth)</Label>
                  <Input
                    type="password"
                    placeholder="OAuth Client Secret"
                    value={googleAdsCreds.clientSecret}
                    onChange={e => setGoogleAdsCreds(c => ({ ...c, clientSecret: e.target.value }))}
                  />
                  <FieldHint>
                    Mismo panel de Google Cloud → se genera junto al Client ID.
                  </FieldHint>
                </div>
              </div>
            </div>

            {/* ── Meta Ads ── */}
            <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-indigo-700">
                  <span className="rounded-md bg-indigo-100 p-1">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02Z" />
                    </svg>
                  </span>
                  Meta Ads (Facebook & Instagram)
                </h3>
                {metaConnected && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Ad Account ID</Label>
                  <Input
                    placeholder="act_123456789"
                    value={metaAdsCreds.adAccountId}
                    onChange={e => setMetaAdsCreds(c => ({ ...c, adAccountId: e.target.value }))}
                  />
                  <FieldHint>
                    En Meta Business Suite → Configuración del negocio → <strong>Cuentas publicitarias</strong>. El ID empieza con <code>act_</code>.
                  </FieldHint>
                </div>
                <div>
                  <Label>System User Access Token</Label>
                  <Input
                    type="password"
                    placeholder="EAAB…"
                    value={metaAdsCreds.accessToken}
                    onChange={e => setMetaAdsCreds(c => ({ ...c, accessToken: e.target.value }))}
                  />
                  <FieldHint>
                    En Meta Business Suite → Configuración → <strong>Usuarios del sistema</strong> → genera token con permiso <em>ads_read</em>. Token permanente (no expira).
                  </FieldHint>
                </div>
              </div>
            </div>

            {/* ── GA4 ── */}
            <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-orange-600">
                  <span className="rounded-md bg-orange-100 p-1">
                    <BarChart3 className="h-4 w-4" />
                  </span>
                  Google Analytics 4 (GA4)
                </h3>
                {ga4Connected && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              </div>

              <div className="max-w-sm">
                <Label>Property ID</Label>
                <Input
                  placeholder="123456789"
                  value={ga4Creds.propertyId}
                  onChange={e => setGa4Creds(c => ({ ...c, propertyId: e.target.value }))}
                />
                <FieldHint>
                  En Google Analytics → Admin (⚙️) → <strong>Propiedad</strong> → Configuración de la propiedad. El ID es un número de 9 dígitos (ej: 123456789). <br />
                  También necesitas un Service Account con acceso a la propiedad y el JSON de credenciales subido a Ajustes.
                </FieldHint>
              </div>

              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">¿Qué métricas se importan?</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li><strong>Sesiones</strong> — visitas a tu sitio web</li>
                  <li><strong>Usuarios nuevos</strong> — primeras visitas</li>
                  <li><strong>Fuentes de tráfico</strong> — orgánico, pagado, social, directo</li>
                  <li><strong>Tasa de rebote</strong> — % que salió sin interactuar</li>
                </ul>
              </div>
            </div>

            {/* Source legend */}
            <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">¿De dónde viene cada métrica?</p>
              <div className="grid gap-2 sm:grid-cols-3 text-xs text-muted-foreground">
                <div className="flex items-start gap-2">
                  <SourceBadge source="google" />
                  <span>Inversión, impresiones y clics de campañas en Google Search/Display/YouTube.</span>
                </div>
                <div className="flex items-start gap-2">
                  <SourceBadge source="meta" />
                  <span>Gasto e impresiones de anuncios en Facebook, Instagram y Audience Network.</span>
                </div>
                <div className="flex items-start gap-2">
                  <SourceBadge source="ga4" />
                  <span>Tráfico web real: sesiones, usuarios, fuentes de adquisición y conversiones.</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
