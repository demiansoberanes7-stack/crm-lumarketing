"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleAlert } from "lucide-react";
import type { OpsData } from "@/server/dashboard/ops";
import { AreaChartCard } from "@/components/dashboard/charts";

/**
 * Pestaña «Actividad» del agente.
 *
 * No hay tabla de ejecuciones del agente: los turnos silenciosos solo van al
 * log. Lo que sí queda escrito son los mensajes (`ai_generated`), los traspasos
 * (`handoff_at`) y la cola de automatizaciones. Eso es lo que se muestra — y
 * cuando no hay nada, se dice, en vez de fingir un historial.
 */
export function AgentActivity() {
  const [ops, setOps] = useState<OpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/dashboard/ops?period=30d", { signal });
      if (!res.ok) throw new Error("ops_failed");
      const json = (await res.json()) as OpsData;
      if (!signal?.aborted) setOps(json);
    } catch {
      if (!signal?.aborted) setFailed(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3" aria-hidden>
        <div className="grid gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl border border-border bg-subtle" />
          ))}
        </div>
        <div className="h-[260px] rounded-xl border border-border bg-subtle" />
      </div>
    );
  }

  if (failed || !ops) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
        <p className="text-[13px] font-medium">No se pudo leer la actividad del agente.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold hover:bg-subtle"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const empty = ops.series.every((p) => p.ai + p.manual + p.inbound === 0) && ops.activity.length === 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Respuestas del agente (24 h)" value={String(ops.agent.aiReplies24h)} />
        <Stat label="Respuestas del equipo (24 h)" value={String(ops.agent.manualReplies24h)} />
        <Stat label="Traspasos a humano (24 h)" value={String(ops.agent.handoffs24h)} />
        <Stat
          label="Última respuesta"
          value={ops.agent.lastAiReplyAt ? timeAgo(ops.agent.lastAiReplyAt) : "Ninguna"}
          hint={ops.agent.lastAiReplyAt ? formatDateTime(ops.agent.lastAiReplyAt) : "El agente no ha respondido todavía"}
        />
      </div>

      <section className="rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold tracking-[-0.01em]">Respuestas por día</h3>
            <p className="mt-0.5 text-[12px] text-text-2">
              Agente frente a equipo en los últimos 30 días.
            </p>
          </div>
          <Link
            href="/inbox"
            className="inline-flex items-center gap-1 text-[12px] font-medium text-text-2 hover:text-foreground"
          >
            Bandeja <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {empty ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
            <p className="text-[13px] font-medium">Sin actividad en 30 días</p>
            <p className="mt-1 max-w-[40ch] text-[12px] text-text-2">
              Cuando el agente o el equipo respondan a un mensaje, verás aquí el detalle diario.
            </p>
          </div>
        ) : (
          <AreaChartCard
            data={ops.series}
            xKey="day"
            yKeys={["ai", "manual"]}
            labels={{ ai: "Agente", manual: "Equipo" }}
            height={240}
          />
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-xs">
        <h3 className="text-[14px] font-semibold tracking-[-0.01em]">Últimos movimientos</h3>
        <p className="mt-0.5 text-[12px] text-text-2">
          Cotizaciones, cambios de etapa y respuestas automáticas.
        </p>
        {ops.activity.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border py-8 text-center text-[12px] text-text-2">
            Todavía no hay movimientos registrados.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {ops.activity.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-subtle"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{item.title}</span>
                    {item.detail ? (
                      <span className="block truncate text-[12px] text-text-2">{item.detail}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-3">{timeAgo(item.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="flex items-start gap-1.5 px-1 text-[11.5px] text-text-3">
        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        El CRM no guarda un historial de ejecuciones del agente; esta pestaña resume lo que sí
        queda registrado: mensajes enviados, traspasos y movimientos comerciales.
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <p className="truncate text-[12px] font-medium text-text-2">{label}</p>
      <p className="mt-2 text-[22px] font-semibold tabular-nums leading-none tracking-[-0.02em]">
        {value}
      </p>
      {hint ? <p className="mt-1.5 truncate text-[11.5px] text-text-3">{hint}</p> : null}
    </div>
  );
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "ayer" : `hace ${days} d`;
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
