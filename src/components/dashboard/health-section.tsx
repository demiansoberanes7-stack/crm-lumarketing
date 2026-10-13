"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartCard } from "./chart-card";

interface Errors { automations: number; webhooks: number; capi: number; messages: number; total: number }
interface Health { errors24h: Errors }

export type ErrorDetailRow = {
  id: string;
  at: string;
  /** Quién o qué estaba en el otro extremo: contacto o recurso afectado. */
  subject: string;
  /** Segunda línea: canal/evento/regla de contexto. */
  context: string;
  error: string;
};

type ErrorKey = "messages" | "automations" | "webhooks" | "capi";

/**
 * Errores de las últimas 24 h. Cada contador es expandible: al abrirlo pide
 * /api/dashboard/errors y muestra QUIÉN recibió el mensaje fallido y QUÉ
 * evento de Conversions API falló, en vez de solo el número.
 */
export function HealthSection({ health }: { health: Health }) {
  const errors = health.errors24h ?? { automations: 0, webhooks: 0, capi: 0, messages: 0, total: 0 };
  const [open, setOpen] = useState<ErrorKey | null>(null);
  const [details, setDetails] = useState<Partial<Record<ErrorKey, ErrorDetailRow[]>>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const errorRows: { key: ErrorKey; label: string; value: number }[] = [
    { key: "messages", label: "Mensajes fallidos", value: errors.messages },
    { key: "automations", label: "Automatizaciones", value: errors.automations },
    { key: "webhooks", label: "Webhooks", value: errors.webhooks },
    { key: "capi", label: "Conversions API", value: errors.capi },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const res = await fetch("/api/dashboard/errors", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const data = (await res.json().catch(() => null)) as Record<string, ErrorDetailRow[]> | null;
      if (data) {
        setDetails({
          messages: data.messages ?? [],
          automations: data.automations ?? [],
          webhooks: data.webhooks ?? [],
          capi: data.capi ?? [],
        });
      }
    } else {
      setFailed(true);
    }
    setLoading(false);
  }, []);

  function toggle(key: ErrorKey) {
    const next = open === key ? null : key;
    setOpen(next);
    if (next && Object.keys(details).length === 0) void load();
  }

  // Si el total cambia a 0 con el panel abierto, no hay nada que mostrar.
  useEffect(() => {
    if (errors.total === 0) setOpen(null);
  }, [errors.total]);

  const rows = open ? details[open] ?? [] : [];

  return (
    <ChartCard title="Errores — últimas 24 h">
      <div className={cn(
        "mb-3 rounded-md border p-3",
        errors.total > 0
          ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
          : "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
      )}>
        <p className="text-2xl font-bold tabular-nums">{errors.total}</p>
        <p className="text-xs text-muted-foreground">eventos con error</p>
      </div>

      <ul className="space-y-1">
        {errorRows.map((r) => {
          const expanded = open === r.key;
          return (
            <li key={r.key}>
              <button
                onClick={() => toggle(r.key)}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-sm transition-colors hover:bg-subtle"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-text-2">
                  <ChevronRight
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-text-3 transition-transform",
                      expanded && "rotate-90"
                    )}
                    strokeWidth={2}
                  />
                  <span className="truncate">{r.label}</span>
                </span>
                <span className={cn(
                  "shrink-0 tabular-nums font-medium",
                  r.value > 0 ? "text-red-600" : "text-muted-foreground"
                )}>
                  {r.value}
                </span>
              </button>

              {expanded && (
                <div className="mb-2 ml-5 border-l-2 border-border pl-3">
                  {loading && rows.length === 0 && !failed ? (
                    <p className="py-2 text-xs text-muted-foreground">Cargando detalle…</p>
                  ) : failed ? (
                    <p className="py-2 text-xs text-muted-foreground">
                      No se pudo cargar el detalle. Abre{" "}
                      <Link className="underline" href="/settings/diagnostics">Diagnóstico</Link>.
                    </p>
                  ) : rows.length === 0 ? (
                    <p className="py-2 text-xs text-muted-foreground">
                      Sin eventos con error en las últimas 24 h.
                    </p>
                  ) : (
                    <ul className="space-y-2 py-1">
                      {rows.map((d) => (
                        <li key={d.id} className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground" title={d.subject}>
                            {d.subject}
                          </p>
                          <p className="truncate font-mono text-[10.5px] tracking-[0.02em] text-text-3" title={d.context}>
                            {d.context} · {new Date(d.at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </p>
                          <p className="break-words text-[11.5px] leading-snug text-red-600 dark:text-red-400">
                            {d.error}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <RefreshCw className="h-3 w-3" /> Ventana móvil de 24 h.{" "}
        <Link className="underline hover:text-foreground" href="/settings/diagnostics">
          Diagnóstico
        </Link>{" "}
        tiene el historial por canal.
      </p>
    </ChartCard>
  );
}
