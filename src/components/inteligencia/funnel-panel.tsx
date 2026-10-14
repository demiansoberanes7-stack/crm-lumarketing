"use client";

import { useEffect, useState } from "react";
import { Filter } from "lucide-react";

/**
 * Embudo comercial del CRM: reparto actual de leads por etapa + movimiento
 * de los últimos N días. Fuente: tablas propias (lead, pipeline_stage,
 * lead_stage_event) — sin terceros. La "conversión" entre etapas es un
 * proxy del reparto actual, NO una tasa histórica de cohortes.
 */

type FunnelStageView = {
  id: string;
  name: string;
  position: number;
  kind: "open" | "qualified" | "won" | "lost";
  leadCount: number;
  pctOfTotal: number;
  conversionPct: number | null;
  eventsInWindow: number;
};

type FunnelView = {
  totalLeads: number;
  windowDays: number;
  eventsTotalInWindow: number;
  wonLeads: number;
  lostLeads: number;
  stages: FunnelStageView[];
};

const KIND_LABEL: Record<FunnelStageView["kind"], string> = {
  open: "abierta",
  qualified: "calificada",
  won: "ganada",
  lost: "perdida",
};

export function FunnelPanel() {
  const [funnel, setFunnel] = useState<FunnelView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/intel/funnel", { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (res?.ok) {
        const data = (await res.json().catch(() => null)) as FunnelView | null;
        setFunnel(data);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const max = funnel ? Math.max(...funnel.stages.map((s) => s.leadCount), 1) : 1;

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Embudo comercial">
      <h2 className="flex items-center gap-2 font-semibold">
        <Filter className="h-4 w-4 text-brand-text" /> Embudo comercial
        <span className="text-sm font-normal text-text-2">(tus leads del CRM)</span>
      </h2>

      {loading && <p className="mt-3 text-sm text-text-2">Cargando embudo…</p>}

      {!loading && funnel && funnel.stages.length === 0 && (
        <p className="mt-3 rounded-md bg-subtle p-3 text-sm text-text-2">
          Aún no hay etapas de pipeline configuradas. Crea etapas en Pipeline para ver el embudo.
        </p>
      )}

      {!loading && funnel && funnel.stages.length > 0 && (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-text-3">Leads</dt>
              <dd className="text-lg font-semibold tabular-nums">{funnel.totalLeads}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-text-3">Ganados</dt>
              <dd className="text-lg font-semibold tabular-nums">{funnel.wonLeads}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-text-3">Perdidos</dt>
              <dd className="text-lg font-semibold tabular-nums">{funnel.lostLeads}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-text-3">
                Movimientos {funnel.windowDays}d
              </dt>
              <dd className="text-lg font-semibold tabular-nums">{funnel.eventsTotalInWindow}</dd>
            </div>
          </dl>

          <ol className="mt-4 space-y-2">
            {funnel.stages.map((stage, i) => {
              const next = funnel.stages[i + 1];
              return (
                <li key={stage.id} className="flex flex-wrap items-center gap-2">
                  <span className="w-[28%] min-w-[110px] truncate text-right text-xs font-medium" title={stage.name}>
                    {stage.name}
                  </span>
                  <span className="relative h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-subtle">
                    <span
                      className="absolute inset-y-0 left-0 rounded-sm bg-brand-text/70"
                      style={{ width: `${(stage.leadCount / max) * 100}%` }}
                    />
                  </span>
                  <span className="w-[88px] shrink-0 text-xs font-medium tabular-nums">
                    {stage.leadCount} · {stage.pctOfTotal.toFixed(0)}%
                  </span>
                  <span className="w-[92px] shrink-0 text-[11px] text-text-3">
                    {stage.eventsInWindow} en {funnel.windowDays}d
                  </span>
                  {next && stage.conversionPct !== null && (
                    <span className="w-[70px] shrink-0 text-[11px] font-medium tabular-nums text-text-2">
                      → {stage.conversionPct.toFixed(0)}%
                    </span>
                  )}
                  <span className="hidden w-[70px] shrink-0 text-right text-[11px] text-text-3 sm:block">
                    {KIND_LABEL[stage.kind]}
                  </span>
                </li>
              );
            })}
          </ol>

          <p className="mt-4 border-t pt-3 text-[11px] leading-snug text-text-3">
            Unidad: número de leads (reparto ACTUAL por etapa, snapshot) y eventos de etapa en
            la ventana ({funnel.windowDays} días). La flecha «→ %» es la conversión entre etapas
            adyacentes calculada del reparto actual — es un proxy, NO una tasa histórica de
            cohortes. Fuente: base de datos del CRM (lead, pipeline_stage, lead_stage_event).
          </p>
        </>
      )}
    </section>
  );
}
