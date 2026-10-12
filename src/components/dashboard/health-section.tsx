"use client";

import { RefreshCw } from "lucide-react";
import { ChartCard } from "./chart-card";

interface Errors { automations: number; webhooks: number; capi: number; messages: number; total: number }
interface Health { errors24h: Errors }

/** Errores de las últimas 24 h (ventana móvil). El detalle por canal vive en Diagnóstico. */
export function HealthSection({ health }: { health: Health }) {
  const errors = health.errors24h ?? { automations: 0, webhooks: 0, capi: 0, messages: 0, total: 0 };
  const errorRows = [
    { label: "Mensajes fallidos", value: errors.messages },
    { label: "Automatizaciones", value: errors.automations },
    { label: "Webhooks", value: errors.webhooks },
    { label: "Conversions API", value: errors.capi },
  ];

  return (
    <ChartCard title="Errores — últimas 24 h">
      <div className={`mb-3 rounded-md border p-3 ${errors.total > 0 ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30" : "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"}`}>
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
      </ul>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <RefreshCw className="h-3 w-3" /> Ventana móvil de 24 h. Abre Diagnóstico para ver el detalle por canal.
      </p>
    </ChartCard>
  );
}
