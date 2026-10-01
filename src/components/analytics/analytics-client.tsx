"use client";

import { useState, useEffect } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, MousePointerClick, RefreshCw, Eye, DollarSign, Plug, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const mockData = [
  { name: "Lun", clics: 400, impr: 2400 },
  { name: "Mar", clics: 300, impr: 1398 },
  { name: "Mié", clics: 200, impr: 9800 },
  { name: "Jue", clics: 278, impr: 3908 },
  { name: "Vie", clics: 189, impr: 4800 },
  { name: "Sáb", clics: 239, impr: 3800 },
  { name: "Dom", clics: 349, impr: 4300 },
];

export function AnalyticsClient() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "settings">("dashboard");
  const [googleAdsCreds, setGoogleAdsCreds] = useState({ clientId: "", clientSecret: "", developerToken: "", customerId: "" });
  const [metaAdsCreds, setMetaAdsCreds] = useState({ accessToken: "", adAccountId: "" });
  const [ga4Creds, setGa4Creds] = useState({ propertyId: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const gAds = await fetch("/api/integrations/google_ads").then(r => r.json());
      const mAds = await fetch("/api/integrations/meta_ads").then(r => r.json());
      const ga4 = await fetch("/api/integrations/ga4").then(r => r.json());
      if (gAds?.credentials) setGoogleAdsCreds(gAds.credentials);
      if (mAds?.credentials) setMetaAdsCreds(mAds.credentials);
      if (ga4?.credentials) setGa4Creds(ga4.credentials);
    }
    void load();
  }, []);

  async function saveIntegration(provider: string, creds: unknown) {
    await fetch(`/api/integrations/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
  }

  async function handleSave() {
    setSaving(true);
    await Promise.all([
      saveIntegration("google_ads", googleAdsCreds),
      saveIntegration("meta_ads", metaAdsCreds),
      saveIntegration("ga4", ga4Creds),
    ]);
    setSaving(false);
  }

  return (
    <div className="flex h-full flex-col bg-background/50 text-foreground">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Marketing Hub</h1>
          <p className="text-sm text-muted-foreground">Mide el rendimiento de tus campañas de Google y Meta Ads</p>
        </div>
        <div className="flex gap-2">
          <Button variant={activeTab === "dashboard" ? "default" : "outline"} onClick={() => setActiveTab("dashboard")}>
            <Activity className="mr-2 h-4 w-4" />
            Dashboard
          </Button>
          <Button variant={activeTab === "settings" ? "default" : "outline"} onClick={() => setActiveTab("settings")}>
            <Plug className="mr-2 h-4 w-4" />
            Integraciones
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        {activeTab === "dashboard" ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* KPI Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <DollarSign className="h-4 w-4 text-emerald-500" />
                  Inversión Total
                </div>
                <div className="mt-2 text-2xl font-bold">$12,450.00 MXN</div>
                <p className="mt-1 text-xs text-emerald-500">+12% vs mes anterior</p>
              </div>
              
              <div className="rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Eye className="h-4 w-4 text-blue-500" />
                  Impresiones
                </div>
                <div className="mt-2 text-2xl font-bold">45,231</div>
                <p className="mt-1 text-xs text-blue-500">+8% vs mes anterior</p>
              </div>

              <div className="rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <MousePointerClick className="h-4 w-4 text-orange-500" />
                  Clics Totales
                </div>
                <div className="mt-2 text-2xl font-bold">2,104</div>
                <p className="mt-1 text-xs text-orange-500">+15% vs mes anterior</p>
              </div>

              <div className="rounded-xl border bg-card p-4 shadow-sm transition-all hover:shadow-md">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <RefreshCw className="h-4 w-4 text-purple-500" />
                  Costo por Lead (CPL)
                </div>
                <div className="mt-2 text-2xl font-bold">$145.20 MXN</div>
                <p className="mt-1 text-xs text-emerald-500">-5% vs mes anterior</p>
              </div>
            </div>

            {/* Charts */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <h3 className="mb-4 text-sm font-semibold">Rendimiento de Clics vs Impresiones</h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={mockData}>
                      <defs>
                        <linearGradient id="colorClics" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}`} />
                      <Tooltip 
                        contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", backgroundColor: "#ffffff", color: "#0f172a" }}
                      />
                      <Area type="monotone" dataKey="clics" stroke="#f97316" strokeWidth={2} fillOpacity={1} fill="url(#colorClics)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <h3 className="mb-4 text-sm font-semibold">Conversión del Pipeline</h3>
                <div className="flex h-[300px] flex-col justify-center items-center gap-4 text-center">
                  <div className="w-full max-w-xs space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Leads Captados</span>
                      <span className="font-bold">145</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full w-[100%] bg-blue-500 rounded-full" />
                    </div>
                    
                    <div className="flex justify-between text-sm pt-2">
                      <span>Cotizados</span>
                      <span className="font-bold">89</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full w-[61%] bg-orange-500 rounded-full" />
                    </div>

                    <div className="flex justify-between text-sm pt-2">
                      <span>Ganados</span>
                      <span className="font-bold">34</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full w-[23%] bg-emerald-500 rounded-full" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">Tasa de conversión global: 23.4%</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Integraciones de Ads</h2>
                <p className="text-sm text-muted-foreground">Conecta tus cuentas publicitarias para importar métricas.</p>
              </div>
              <Button onClick={() => void handleSave()} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Guardando..." : "Guardar Cambios"}
              </Button>
            </div>

            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="mb-4 flex items-center font-semibold text-blue-600">
                <span className="mr-2 rounded-md bg-blue-100 p-1">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21.35,11.1H12.18V13.83H18.69C18.36,17.64 15.19,19.27 12.19,19.27C8.36,19.27 5,16.25 5,12C5,7.9 8.2,4.73 12.2,4.73C15.29,4.73 17.1,6.7 17.1,6.7L19,4.72C19,4.72 16.56,2 12.1,2C6.42,2 2.03,6.8 2.03,12C2.03,17.05 6.16,22 12.25,22C17.6,22 21.5,18.33 21.5,12.91C21.5,11.76 21.35,11.1 21.35,11.1V11.1Z" />
                  </svg>
                </span>
                Google Ads
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Customer ID</Label>
                  <Input 
                    placeholder="123-456-7890" 
                    value={googleAdsCreds.customerId} 
                    onChange={e => setGoogleAdsCreds(c => ({...c, customerId: e.target.value}))} 
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Developer Token</Label>
                  <Input 
                    type="password"
                    placeholder="Token de Google Ads API" 
                    value={googleAdsCreds.developerToken} 
                    onChange={e => setGoogleAdsCreds(c => ({...c, developerToken: e.target.value}))} 
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Client ID</Label>
                  <Input 
                    placeholder="OAuth Client ID" 
                    value={googleAdsCreds.clientId} 
                    onChange={e => setGoogleAdsCreds(c => ({...c, clientId: e.target.value}))} 
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Client Secret</Label>
                  <Input 
                    type="password"
                    placeholder="OAuth Client Secret" 
                    value={googleAdsCreds.clientSecret} 
                    onChange={e => setGoogleAdsCreds(c => ({...c, clientSecret: e.target.value}))} 
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="mb-4 flex items-center font-semibold text-blue-800">
                <span className="mr-2 rounded-md bg-blue-100 p-1">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02Z"/>
                  </svg>
                </span>
                Meta Ads (Facebook & Instagram)
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Ad Account ID</Label>
                  <Input 
                    placeholder="act_123456789" 
                    value={metaAdsCreds.adAccountId} 
                    onChange={e => setMetaAdsCreds(c => ({...c, adAccountId: e.target.value}))} 
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>System User Access Token</Label>
                  <Input 
                    type="password"
                    placeholder="EAAB..." 
                    value={metaAdsCreds.accessToken} 
                    onChange={e => setMetaAdsCreds(c => ({...c, accessToken: e.target.value}))} 
                  />
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-6 shadow-sm">
              <h3 className="mb-4 flex items-center font-semibold text-orange-500">
                <span className="mr-2 rounded-md bg-orange-100 p-1">
                  <Activity className="h-4 w-4" />
                </span>
                Google Analytics 4 (GA4)
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Property ID</Label>
                  <Input 
                    placeholder="123456789" 
                    value={ga4Creds.propertyId} 
                    onChange={e => setGa4Creds(c => ({...c, propertyId: e.target.value}))} 
                  />
                </div>
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
