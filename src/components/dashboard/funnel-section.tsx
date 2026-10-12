"use client";

import { useState } from "react";
import { FunnelChart } from "./charts";
import { ChartCard } from "./chart-card";

interface Stage { stage: string; value: number }

/**
 * Embudo interactivo con % de conversión y volumen de caída por etapa.
 * Al hacer clic en una etapa se resalta y muestra el detalle de la caída.
 */
export function FunnelSection({ title, stages, hint }: { title: string; stages: Stage[]; hint?: string }) {
  const [selected, setSelected] = useState<number | null>(null);

  if (stages.length === 0) {
    return (
      <ChartCard title={title}>
        <p className="py-8 text-center text-sm text-muted-foreground">Sin datos para el embudo.</p>
      </ChartCard>
    );
  }

  const selectedStage = selected != null ? stages[selected] : null;
  const prevStage = selected != null && selected > 0 ? stages[selected - 1] : null;
  const drop = selectedStage && prevStage ? prevStage.value - selectedStage.value : null;
  const dropPct = selectedStage && prevStage && prevStage.value > 0
    ? ((prevStage.value - selectedStage.value) / prevStage.value) * 100
    : null;

  return (
    <ChartCard title={title}>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <FunnelChart data={stages} height={200} />
      {/* Conversión global y por etapa */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stages.slice(0, -1).map((s, i) => {
          const next = stages[i + 1];
          const rate = s.value > 0 && next ? (next.value / s.value) * 100 : null;
          return (
            <button
              key={s.stage}
              type="button"
              onClick={() => setSelected(selected === i + 1 ? null : i + 1)}
              className={`rounded-md border p-2 text-center transition-colors ${
                selected === i + 1 ? "border-primary bg-primary/10" : "hover:bg-accent"
              }`}
            >
              <p className="text-lg font-bold tabular-nums">{rate != null ? `${rate.toFixed(0)}%` : "N/D"}</p>
              <p className="text-[10px] text-muted-foreground">{s.stage} → {next?.stage}</p>
            </button>
          );
        })}
      </div>
      {selectedStage && drop != null && (
        <p className="mt-2 rounded-md bg-subtle p-2 text-xs text-text-2">
          <span className="font-semibold text-foreground">{selectedStage.stage}</span>: se pierden{' '}
          <span className="font-semibold tabular-nums">{drop}</span> ({dropPct != null ? `${dropPct.toFixed(0)}%` : "N/D"}) respecto a la etapa anterior.
        </p>
      )}
      {/* Volumen total vs. salida */}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Entrada: {stages[0]!.value} · Salida: {stages[stages.length - 1]!.value} · Conversión global:{" "}
        {stages[0]!.value > 0 ? `${((stages[stages.length - 1]!.value / stages[0]!.value) * 100).toFixed(1)}%` : "N/D"}
      </p>
    </ChartCard>
  );
}
