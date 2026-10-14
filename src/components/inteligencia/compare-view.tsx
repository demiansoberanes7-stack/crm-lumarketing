"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GitCompareArrows, X } from "lucide-react";

const numberCompact = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });
const p2 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

export type CompareItem = {
  termId: string;
  name: string;
  seriesPoints: Array<{ day: string; value: number }>;
  descriptive: { n: number; mean: number; median: number; std: number; p25: number; p75: number; min: number; max: number };
  z: number | null;
  sharePct: number;
  lastValue: number;
  classification: "A" | "B" | "C" | "D";
};

const LINE_COLORS = ["var(--chart-2)", "var(--chart-3)", "var(--chart-1)"];
const CLS_LABEL: Record<CompareItem["classification"], string> = {
  A: "A · crece",
  B: "B · estable",
  C: "C · contrae",
  D: "D · sin datos",
};

/**
 * Comparativa de 2–3 nichos con unidades idénticas: series indexadas
 * (día 1 = 100) para poder superponer escalas distintas, y tabla con las
 * mismas métricas y ventana para todos.
 */
export function CompareView({
  items,
  onRemove,
  onClear,
}: {
  items: CompareItem[];
  onRemove: (termId: string) => void;
  onClear: () => void;
}) {
  // Serie indexada: base 100 en el primer día con dato de cada nicho.
  const days = [...new Set(items.flatMap((i) => i.seriesPoints.map((p) => p.day)))].sort();
  const chartData = days.map((day) => {
    const row: Record<string, string | number | null> = { day };
    for (const item of items) {
      const point = item.seriesPoints.find((p) => p.day === day);
      const base = item.seriesPoints[0]?.value ?? 0;
      row[item.name] =
        point && base > 0 ? Math.round((point.value / base) * 100) : null;
    }
    return row;
  });

  return (
    <section className="space-y-4" aria-label="Comparativa de nichos">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <GitCompareArrows className="h-4 w-4 text-brand-text" /> Comparativa
            <span className="text-sm font-normal text-text-2">({items.length} nichos · misma ventana y unidades)</span>
          </h2>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent"
          >
            <X className="mr-1 h-4 w-4" /> Cerrar comparativa
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {items.map((item, i) => (
            <span
              key={item.termId}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
              style={{ borderColor: LINE_COLORS[i], color: LINE_COLORS[i] }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: LINE_COLORS[i] }} />
              {item.name}
              <button
                type="button"
                aria-label={`Quitar ${item.name}`}
                onClick={() => onRemove(item.termId)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-accent"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        {days.length >= 2 ? (
          <div className="mt-4 h-64" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} width={40} label={{ value: "índice", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <Tooltip formatter={(v) => (v == null ? "—" : `índice ${v}`)} labelFormatter={(l) => `Día ${l}`} />
                <Legend />
                {items.map((item, i) => (
                  <Line
                    key={item.termId}
                    type="monotone"
                    dataKey={item.name}
                    stroke={LINE_COLORS[i]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-4 rounded-md bg-subtle p-3 text-sm text-text-2">
            Se necesitan al menos 2 días con dato para graficar la evolución comparada.
          </p>
        )}
        <p className="mt-2 text-[11px] leading-snug text-text-3">
          Serie indexada: el primer día con dato de cada nicho = 100. Permite comparar la FORMA de
          la evolución entre nichos de distinto volumen; no compara magnitudes absolutas (usa la tabla).
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b bg-subtle text-left text-xs text-text-3">
              <th className="px-4 py-2.5 font-medium">Nicho</th>
              <th className="px-4 py-2.5 font-medium">Clasif.</th>
              <th className="px-4 py-2.5 text-right font-medium">Share %</th>
              <th className="px-4 py-2.5 text-right font-medium">Índice GT</th>
              <th className="px-4 py-2.5 text-right font-medium">Mediana/día</th>
              <th className="px-4 py-2.5 text-right font-medium">z-score</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.termId} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium">{item.name}</td>
                <td className="px-4 py-2.5 text-text-2">{CLS_LABEL[item.classification]}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{item.sharePct.toFixed(1)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{numberCompact.format(item.lastValue)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{numberCompact.format(item.descriptive.median)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{item.z === null ? "s/ base" : p2.format(item.z)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-snug text-text-3">
        Mismas unidades y ventana (30 días, UTC) para todos. Share = % del interés GT del
        último día entre los nichos comparados; z-score = últimos 7 días vs 21 previos.
        Fuente: Google Trends (MX), 100 % externa.
      </p>
    </section>
  );
}
