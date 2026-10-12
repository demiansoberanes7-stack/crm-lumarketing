"use client";

import { AlertTriangle, CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import { ChartCard } from "./chart-card";

interface Integration { name: string; status: string; lastSyncAt: string | null; lastError: string | null }
interface Errors { automations: number; webhooks: number; capi: number; messages: number; total: number }
interface Health { integrations: Integration[]; errors24h: Errors; syncFailures: number }

const INTEGRATION_LABEL: Record<string, string> = {
  meta_ads: "Meta Ads", google_ads: "Google Ads", ga4: "Google Analytics 4",
  google_business: "Google Business", calendar: "Google Calendar",
};

const STATUS_META: Record<string, { icon: React.ReactNode; label: string; cls: string }> = {
  ok: { icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, label: "Conectado", cls: "text-emerald-600" },
  stale: { icon: <CircleAlert className="h-4 w-4 text-amber-500" />, label: "Desactualizado", cls: "text-amber-600" },
  never: { icon: <CircleAlert className="h-4 w-4 text-muted-foreground" />, label: "Sin sincronizar", cls: "text-muted-foreground" },
  error: { icon: <AlertTriangle className="h-4 w-4 text-red-500" />, label: "Error", cls: "text-red-600" },
};

/** Panel de salud del sistema: estado de integraciones y errores recientes. */
export function HealthSection({ health }: { health: Health }) {
  const integrations = health.integrations ?? [];
  const errors = health.errors24h ?? { automations: 0, webhooks: 0, capi: 0, messages: 0, total: 0 };
  const errorRows = [
    { label: "Mensajes fallidos", value: errors.messages },
    { label: "Automatizaciones", value: errors.automations },
    { label: "Webhooks", value: errors.webhooks },
    { label: "Conversions API", value: errors.capi },
  ];

  return (
    <ChartCard title="Salud del sistema">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Integraciones (API)</h3>
          {integrations.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Sin integraciones registradas.</p>
          ) : (
            <ul className="space-y-1.5">
              {integrations.map((it) => {
                const meta = STATUS_META[it.status] ?? STATUS_META.never!;
                return (
                  <li key={it.name} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      {meta.icon}
                      <span className="truncate">{INTEGRATION_LABEL[it.name] ?? it.name}</span>
                    </span>
                    <span className={`shrink-0 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Errores últimas 24 h</h3>
          <div className={`mb-2 rounded-md border p-3 ${errors.total > 0 ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30" : "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"}`}>
            <p className="text-2xl font-bold tabular-nums">{errors.total}</p>
            <p className="text-xs text-muted-foreground">eventos con error</p>
          </div>
          <ul className="space-y-1">
            {errorRows.map((r) => (
              <li key={r.label} className="flex items-center justify-between text-sm">
                <span className="text-text-2">{r.label}</span>
                <span className={`tabular-nums font-medium ${r.value > 0 ? "text-red-600" : "text-muted-foreground"}`}>{r.value}</span>
              </li>
            ))}
            <li className="flex items-center justify-between border-t pt-1 text-sm">
              <span className="text-text-2">Fallos de sincronización</span>
              <span className={`tabular-nums font-medium ${health.syncFailures > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{health.syncFailures}</span>
            </li>
          </ul>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <RefreshCw className="h-3 w-3" /> Los errores se recalculan en cada visita (ventana de 24 h). Abre Diagnóstico para ver el detalle por canal.
      </p>
    </ChartCard>
  );
}
