"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  buildKeywordIdeas,
  keywordInterestTrend,
  type MarketIdea,
} from "@/lib/intel-content";

/* ── Paleta de líneas (tokens chart) ─────────────────────────────────────── */

const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

/* ── Tipos ───────────────────────────────────────────────────────────────── */

export type TrendSeries = {
  termId: string;
  name: string;
  /** z-score de últimos 7 días vs 21 previos (null si no hay base). */
  z: number | null;
  /** Índice GT del último día (0–100). */
  lastValue: number;
  /** Serie de la ventana GT (30 días). */
  series: Array<{ day: string; value: number }>;
};

export type RankedNiche = {
  termId: string;
  name: string;
  /** Índice 0–100 (100 = nicho más fuerte de la ventana). */
  index: number;
  /** Dirección: "up" | "down" | "flat" según z-score. */
  direction: "up" | "down" | "flat";
  /** Clasificación A/B/C/D del sistema de stats. */
  classification: "A" | "B" | "C" | "D";
  /** Recomendación accionable para contenido/publicidad. */
  recommendation: string;
  /** Color de la recomendación. */
  recTone: "success" | "warning" | "danger" | "neutral";
  /** Índice GT del último día. */
  lastViews: number;
};

/* ── Cálculo del ranking ─────────────────────────────────────────────────── */

function classifyZ(z: number | null, daysWithData: number): "A" | "B" | "C" | "D" {
  if (daysWithData < 7) return "D";
  if (z === null) return "D";
  if (z >= 1.5) return "A";
  if (z >= 0) return "B";
  return "C";
}

function recommendationFor(
  cls: "A" | "B" | "C" | "D",
  lastViews: number
): { text: string; tone: RankedNiche["recTone"] } {
  if (cls === "A") return { text: "Publicar ahora — interés en alza clara", tone: "success" };
  if (cls === "B") return { text: "Mantener — interés estable", tone: "neutral" };
  if (cls === "C") return { text: "Reducir — interés a la baja", tone: "danger" };
  if (lastViews === 0) return { text: "Sin datos — ingesta pendiente", tone: "neutral" };
  return { text: "Pocos días de dato — monitorear", tone: "warning" };
}

/**
 * Construye el ranking accionable a partir de las series de tendencias.
 * Normaliza cada serie a 0–100 (su propio máximo) para poder compararlas,
 * y clasifica con el z-score de stats (A/B/C/D).
 */
export function buildRanking(trends: TrendSeries[]): RankedNiche[] {
  const items: RankedNiche[] = [];
  for (const t of trends) {
    const values = t.series.map((s) => s.value);
    const max = values.length > 0 ? Math.max(...values, 1) : 1;
    const index = values.length > 0 ? Math.round((values[values.length - 1]! / max) * 100) : 0;
    const recent = values.slice(-7);
    const prior = values.slice(0, -7);
    // z-score simple: media reciente vs media previa, normalizada por desv.
    let z: number | null = null;
    if (prior.length >= 7) {
      const mu = prior.reduce((a, b) => a + b, 0) / prior.length;
      const variance = prior.reduce((a, v) => a + (v - mu) ** 2, 0) / (prior.length - 1);
      const sd = Math.sqrt(variance);
      if (sd > 0) {
        const recMean = recent.reduce((a, b) => a + b, 0) / recent.length;
        z = (recMean - mu) / sd;
      }
    }
    const cls = classifyZ(z, values.length);
    const rec = recommendationFor(cls, t.lastValue);
    const direction: RankedNiche["direction"] = z === null ? "flat" : z >= 0.5 ? "up" : z <= -0.5 ? "down" : "flat";
    items.push({
      termId: t.termId,
      name: t.name,
      index,
      direction,
      classification: cls,
      recommendation: rec.text,
      recTone: rec.tone,
      lastViews: t.lastValue,
    });
  }
  // Orden: A primero, luego B, C, D; dentro de cada clase por índice desc.
  const order = { A: 0, B: 1, C: 2, D: 3 } as const;
  items.sort((a, b) => order[a.classification] - order[b.classification] || b.index - a.index);
  return items;
}

/* ── Gráfica comparativa multi-nicho ─────────────────────────────────────── */

/**
 * Gráfica de líneas con TODOS los nichos normalizados a 0–100 (cada uno
 * contra su propio máximo de la ventana). Sirve para ver de un vistazo
 * cuáles están subiendo y cuáles bajando en las últimas 2 semanas.
 */
export function GtCompareChart({ trends }: { trends: TrendSeries[] }) {
  const { data, series } = useMemo(() => {
    // Unir todos los días únicos en orden.
    const allDays = new Set<string>();
    for (const t of trends) for (const s of t.series) allDays.add(s.day);
    const days = [...allDays].sort();

    // Normalizar cada serie a 0–100.
    const normalized = trends.map((t) => {
      const values = t.series.map((s) => s.value);
      const max = values.length > 0 ? Math.max(...values, 1) : 1;
      const byDay = new Map<string, number>();
      for (const s of t.series) byDay.set(s.day, Math.round((s.value / max) * 100));
      return { termId: t.termId, name: t.name, byDay };
    });

    // Construir filas { day, [termId]: index }.
    const rows = days.map((day) => {
      const row: Record<string, unknown> = { day };
      for (const n of normalized) row[n.termId] = n.byDay.get(day) ?? null;
      return row;
    });

    const seriesCfg = normalized.slice(0, 6).map((n, i) => ({
      termId: n.termId,
      name: n.name,
      color: SERIES_COLORS[i % SERIES_COLORS.length]!,
    }));

    return { data: rows, series: seriesCfg };
  }, [trends]);

  if (series.length === 0) return null;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fontSize: 10, fill: "var(--chart-text)" }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={36}
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: "var(--chart-text)" }}
          />
          <Tooltip
            cursor={{ stroke: "var(--chart-grid)", strokeDasharray: "3 3" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-md">
                  <p className="mb-0.5 font-medium text-foreground">{String(label)}</p>
                  {payload.map((entry) => {
                    const s = series.find((x) => x.termId === entry.dataKey);
                    return (
                      <p key={entry.dataKey} className="tabular-nums text-text-2">
                        <span
                          className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                          style={{ background: s?.color ?? entry.color }}
                        />
                        {s?.name ?? entry.dataKey}: {entry.value == null ? "—" : String(entry.value)}
                      </p>
                    );
                  })}
                </div>
              );
            }}
          />
          {series.map((s) => (
            <Line
              key={s.termId}
              dataKey={s.termId}
              type="monotone"
              stroke={s.color}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Tabla de ranking accionable ─────────────────────────────────────────── */

const CLS_BADGE: Record<RankedNiche["classification"], { label: string; cls: string }> = {
  A: { label: "A · Alza", cls: "border-success-soft bg-success-tint text-success-text" },
  B: { label: "B · Estable", cls: "border-border bg-subtle text-text-2" },
  C: { label: "C · Baja", cls: "border-danger-soft bg-danger-tint text-danger-text" },
  D: { label: "D · Sin dato", cls: "border-warning-soft bg-warning-tint text-warning-text" },
};

const ARROW = { up: "↑", down: "↓", flat: "→" } as const;

/**
 * Tabla de ranking: cada nicho con su índice, tendencia, clasificación y
 * recomendación accionable. Es la guía principal para elegir de qué hacer
 * contenido o pautar esta semana.
 */
export function GtRanking({ ranking }: { ranking: RankedNiche[] }) {
  if (ranking.length === 0) return null;
  const top = ranking.filter((r) => r.classification === "A" || r.classification === "B");

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Ranking de nichos">
      <h2 className="font-semibold">¿De qué hacer contenido esta semana?</h2>
      <p className="mt-1 text-xs text-text-3">
        Según tus <strong>nichos monitoreados</strong>: z-score de los últimos 7 días
        contra los 21 previos · A = alza clara, B = estable, C = baja, D = sin datos
        suficientes.
      </p>

      {top.length > 0 && (
        <div className="mt-3 rounded-md border border-success-soft bg-success-tint p-3 text-sm">
          <p className="font-medium text-success-text">
            Enfócate en: {top.slice(0, 3).map((t) => t.name).join(", ")}
          </p>
          <p className="mt-0.5 text-xs text-success-text opacity-80">
            Estos nichos tienen interés estable o en alza según los últimos 30 días.
          </p>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-text-3">
              <th className="pb-2 pr-3 font-medium">#</th>
              <th className="pb-2 pr-3 font-medium">Nicho</th>
              <th className="pb-2 pr-3 font-medium">Interés</th>
              <th className="pb-2 pr-3 font-medium">Tendencia</th>
              <th className="pb-2 pr-3 font-medium">Clase</th>
              <th className="pb-2 font-medium">Recomendación</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((r, i) => {
              const badge = CLS_BADGE[r.classification];
              return (
                <tr key={r.termId} className="border-b border-border/50 last:border-0">
                  <td className="py-2 pr-3 tabular-nums text-text-3">{i + 1}</td>
                  <td className="py-2 pr-3 font-medium">{r.name}</td>
                  <td className="py-2 pr-3 tabular-nums">{r.index}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        r.direction === "up"
                          ? "font-medium text-success-text"
                          : r.direction === "down"
                            ? "font-medium text-danger-text"
                            : "text-text-3"
                      }
                    >
                      {ARROW[r.direction]}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant="outline" className={badge.cls}>{badge.label}</Badge>
                  </td>
                  <td className="py-2 text-text-2">{r.recommendation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 border-t pt-2 text-[11px] leading-snug text-text-3">
        Índice: interés de búsqueda relativo al máximo de la ventana (0–100).
        Tendencia: z-score de la ventana reciente contra el histórico. Fuente:
        Google Trends (MX, endpoint no oficial), 100 % externa.
      </p>
    </section>
  );
}

/* ── Ideas de contenido para la palabra buscada ──────────────────────────── */

/**
 * Panel semanal de la búsqueda: usa la serie, las consultas y los temas que
 * Google Trends devolvió PARA ESA palabra. No toca el catálogo de nichos
 * monitoreados, así que no puede mostrar datos de una búsqueda anterior.
 */
export function KeywordContentRanking({
  query,
  market,
  marketNote,
}: {
  query: string;
  market: {
    series: Array<{ day: string; value: number }>;
    topics: MarketIdea[];
    queries: MarketIdea[];
  } | null;
  marketNote: string | null;
}) {
  const trend = keywordInterestTrend(market?.series ?? []);
  const ideas = market
    ? buildKeywordIdeas({ queries: market.queries, topics: market.topics })
    : [];
  const rising = ideas.filter((idea) => idea.rising).slice(0, 3);
  const focus = rising.length > 0 ? rising : ideas.slice(0, 3);
  const trendArrow = trend ? ARROW[trend.direction] : "→";
  const toneClass =
    trend?.tone === "success"
      ? "border-success-soft bg-success-tint text-success-text"
      : trend?.tone === "danger"
        ? "border-danger-soft bg-danger-tint text-danger-text"
        : "border-border bg-subtle text-text-2";

  return (
    <section
      className="rounded-xl border bg-card p-5 shadow-sm"
      aria-label={`Ideas de contenido para ${query}`}
    >
      <h2 className="font-semibold">¿De qué hacer contenido sobre «{query}» esta semana?</h2>
      <p className="mt-1 text-xs text-text-3">
        Ideas tomadas de las consultas y temas relacionados que Google Trends
        devolvió para esta búsqueda. No usa tus nichos monitoreados.
      </p>

      {trend && (
        <div className={`mt-3 rounded-md border p-3 text-sm ${toneClass}`}>
          <p className="font-medium">
            «{query}» · interés {trend.index}/100 {trendArrow}
            {trend.changePct !== null ? ` ${trend.changePct > 0 ? "+" : ""}${trend.changePct}%` : ""}
          </p>
          <p className="mt-0.5 text-xs opacity-80">{trend.recommendation}</p>
        </div>
      )}

      {focus.length > 0 && (
        <div className="mt-3 rounded-md border border-success-soft bg-success-tint p-3 text-sm">
          <p className="font-medium text-success-text">
            Enfócate en: {focus.map((idea) => idea.name).join(", ")}
          </p>
          <p className="mt-0.5 text-xs text-success-text opacity-80">
            {rising.length > 0
              ? "Consultas relacionadas en alza para esta búsqueda."
              : "Lo más buscado junto a esta palabra en los últimos 30 días."}
          </p>
        </div>
      )}

      {ideas.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-text-3">
                <th className="pb-2 pr-3 font-medium">#</th>
                <th className="pb-2 pr-3 font-medium">Idea de contenido</th>
                <th className="pb-2 pr-3 font-medium">Tipo</th>
                <th className="pb-2 pr-3 font-medium">Interés</th>
                <th className="pb-2 pr-3 font-medium">Tendencia</th>
                <th className="pb-2 font-medium">Recomendación</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((idea, i) => (
                <tr key={idea.key} className="border-b border-border/50 last:border-0">
                  <td className="py-2 pr-3 tabular-nums text-text-3">{i + 1}</td>
                  <td className="py-2 pr-3 font-medium">{idea.name}</td>
                  <td className="py-2 pr-3 capitalize text-text-2">{idea.kind}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {idea.value > 0 ? idea.value : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        idea.rising ? "font-medium text-success-text" : "text-text-3"
                      }
                    >
                      {idea.rising ? "↑" : "→"}
                      {idea.rising && idea.pct !== null ? ` +${idea.pct}%` : ""}
                    </span>
                  </td>
                  <td className="py-2 text-text-2">{idea.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 rounded-md border bg-subtle px-3 py-2 text-xs text-text-2">
          Google Trends no devolvió consultas ni temas relacionados para «{query}»
          {marketNote ? `: ${marketNote}` : "."}
        </p>
      )}

      <p className="mt-3 border-t pt-2 text-[11px] leading-snug text-text-3">
        Interés: índice relativo 0–100 de Google Trends para la consulta. Las
        ideas en alza son las que Google marca como «rising» o «breakout» en la
        misma ventana. Fuente externa; no se rellena con datos inventados.
      </p>
    </section>
  );
}
