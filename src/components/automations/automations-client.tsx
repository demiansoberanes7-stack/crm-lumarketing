"use client";

import { useState } from "react";
import {
  Clock,
  GitBranch,
  MessageSquareMore,
  Play,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface AutomationRule {
  id: string;
  name: string;
  trigger: string;
  action: string;
  delay: string;
  enabled: boolean;
}

const PRESET_RULES: AutomationRule[] = [
  {
    id: "followup-3d",
    name: "Seguimiento automático — 3 días",
    trigger: "Lead pasa a etapa «Cotizado»",
    action: "Enviar mensaje de seguimiento por WhatsApp",
    delay: "72 horas",
    enabled: true,
  },
  {
    id: "followup-7d",
    name: "Segundo seguimiento — 7 días",
    trigger: "Sin respuesta tras primer seguimiento",
    action: "Enviar recordatorio final de cotización",
    delay: "168 horas",
    enabled: false,
  },
  {
    id: "welcome",
    name: "Bienvenida automática",
    trigger: "Nuevo lead entra al pipeline",
    action: "Enviar mensaje de bienvenida del agente",
    delay: "Inmediato",
    enabled: false,
  },
];

const statusColors: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600 border-emerald-200",
  inactive: "bg-zinc-500/10 text-zinc-500 border-zinc-200",
};

export function AutomationsClient() {
  const [rules, setRules] = useState<AutomationRule[]>(PRESET_RULES);
  const [testConvId, setTestConvId] = useState("");
  const [testDelayH, setTestDelayH] = useState("72");
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    msg: string;
  } | null>(null);
  const [triggering, setTriggering] = useState(false);

  function toggleRule(id: string) {
    setRules((r) =>
      r.map((rule) =>
        rule.id === id ? { ...rule, enabled: !rule.enabled } : rule
      )
    );
  }

  async function triggerManual() {
    if (!testConvId.trim()) return;
    setTriggering(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/automations/followup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: testConvId.trim(),
          delayHours: Number(testDelayH) || 72,
        }),
      });
      const data = (await res.json()) as { ok: boolean; workflowId?: string; error?: string };
      if (data.ok) {
        setTestResult({ ok: true, msg: `Workflow iniciado: ${data.workflowId}` });
      } else {
        setTestResult({ ok: false, msg: data.error ?? "Error al iniciar workflow" });
      }
    } catch {
      setTestResult({ ok: false, msg: "Error de red" });
    } finally {
      setTriggering(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-background/50 text-foreground">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Automatizaciones</h1>
          <p className="text-sm text-muted-foreground">
            Flujos de trabajo automáticos para seguimiento y retargeting de leads
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-medium text-muted-foreground">Motor Temporal</span>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 space-y-8">

        {/* Stats Banner */}
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Flujos activos", value: rules.filter(r => r.enabled).length, icon: Zap, color: "text-brand" },
            { label: "Seguimientos enviados", value: "24", icon: MessageSquareMore, color: "text-blue-500" },
            { label: "Tasa de respuesta", value: "34%", icon: RefreshCw, color: "text-emerald-500" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div
              key={label}
              className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className={`rounded-lg bg-muted p-2.5 ${color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Rules List */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Reglas de automatización
          </h2>
          <div className="space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="group relative flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-center"
              >
                {/* Icon */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <GitBranch className="h-5 w-5" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{rule.name}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Zap className="h-3 w-3 text-orange-400" />
                      {rule.trigger}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-blue-400" />
                      {rule.delay}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquareMore className="h-3 w-3 text-emerald-400" />
                      {rule.action}
                    </span>
                  </div>
                </div>

                {/* Badge */}
                <span
                  className={`hidden shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold sm:block ${
                    rule.enabled
                      ? statusColors.active
                      : statusColors.inactive
                  }`}
                >
                  {rule.enabled ? "Activo" : "Inactivo"}
                </span>

                {/* Toggle */}
                <button
                  onClick={() => toggleRule(rule.id)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={rule.enabled ? "Desactivar" : "Activar"}
                >
                  {rule.enabled ? (
                    <ToggleRight className="h-6 w-6 text-brand" />
                  ) : (
                    <ToggleLeft className="h-6 w-6" />
                  )}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Manual Trigger Panel */}
        <section className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b px-5 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
              <Play className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold text-sm">Disparar manualmente</p>
              <p className="text-xs text-muted-foreground">
                Inicia un seguimiento ahora para cualquier conversación
              </p>
            </div>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  ID de conversación
                </label>
                <input
                  type="text"
                  placeholder="cv_xxxxxxxxxxxxxxxx"
                  value={testConvId}
                  onChange={(e) => setTestConvId(e.target.value)}
                  className="w-full rounded-lg border bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-brand/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Esperar (horas)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="72"
                  value={testDelayH}
                  onChange={(e) => setTestDelayH(e.target.value)}
                  className="w-full rounded-lg border bg-muted/40 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-brand/50"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                disabled={triggering || !testConvId.trim()}
                onClick={() => void triggerManual()}
              >
                {triggering ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Iniciando…
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Iniciar flujo
                  </>
                )}
              </Button>

              {testResult && (
                <span
                  className={`text-sm font-medium ${
                    testResult.ok ? "text-emerald-600" : "text-amber-600"
                  }`}
                >
                  {testResult.msg}
                </span>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              💡 El motor Temporal debe estar corriendo (
              <code className="rounded bg-muted px-1">docker compose -f docker-compose.dev.yml up -d temporal</code>
              ) para que los flujos se persistan. Si no está disponible, el endpoint devuelve un aviso suave y no rompe el CRM.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
