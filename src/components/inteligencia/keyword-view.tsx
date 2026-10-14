"use client";

import { useState } from "react";
import { Check, Gauge, HelpCircle, Plus, Search } from "lucide-react";
import { DottedAreaChart } from "@/components/ui/chart";

/**
 * Overview de palabra clave estilo SEMrush: fuentes 100 % externas.
 * KPIs (dificultad DENUE + interés GT), historial GT, relacionadas
 * (autocompletado público de Google) y preguntas. Sin SERP de YouTube
 * ni vistas de canales.
 */

type Intent = "transaccional" | "comercial" | "informativo" | "navegacional";

export type KeywordOverviewView = {
  query: string;
  intent: Intent;
  difficulty: {
    score: number;
    band: string;
    factors: Array<{ label: string; raw: string; weightPct: number; factorScore: number }>;
    formula: string;
  };
  competition: { establishments: number; censored: boolean } | null;
  related: Array<{
    keyword: string;
    intent: Intent;
    tracked: { lastValue: number } | null;
  }>;
  questions: string[];
  tracked: {
    termId: string;
    name: string;
    classification: "A" | "B" | "C" | "D";
    z: number | null;
    seriesPoints: Array<{ day: string; value: number }>;
  } | null;
  sources: string[];
  generatedAt: string;
};

const numberCompact = new Intl.NumberFormat("es-MX", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const p1 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

const INTENT_BADGE: Record<Intent, { label: string; cls: string }> = {
  transaccional: { label: "Transaccional", cls: "border-success-soft bg-success-tint text-success-text" },
  comercial: { label: "Comercial", cls: "border-warning-soft bg-warning-tint text-warning-text" },
  informativo: { label: "Informativo", cls: "border-border bg-subtle text-text-2" },
  navegacional: { label: "Navegacional", cls: "border-brand-soft bg-brand-tint text-brand-text" },
};

function IntentBadge({ intent }: { intent: Intent }) {
  const b = INTENT_BADGE[intent];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${b.cls}`}>
      {b.label}
    </span>
  );
}

function bandColor(band: string): string {
  if (band === "baja") return "var(--success)";
  if (band === "media") return "var(--warning)";
  if (band === "alta") return "var(--danger)";
  return "var(--danger)";
}

function StatCard({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <article className="stat-card min-w-0 rounded-xl border bg-card p-4 shadow-xs">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</p>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] leading-snug text-text-3">{hint}</p>}
    </article>
  );
}

function MonitorButton({
  keyword,
  already,
  pending,
  onMonitor,
  compact = false,
}: {
  keyword: string;
  already: boolean;
  pending: boolean;
  onMonitor: (keyword: string) => void;
  compact?: boolean;
}) {
  if (already) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
        title="Ya está en tu catálogo de monitoreo"
      >
        <Check className="h-3 w-3" /> Monitoreando
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onMonitor(keyword)}
      disabled={pending}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium text-brand-text hover:bg-brand-tint disabled:opacity-60 ${
        compact ? "" : "min-h-7"
      }`}
      title="Agregar al catálogo: entra al ranking y a las tendencias GT"
    >
      <Plus className="h-3 w-3" />
      {pending ? "Agregando…" : compact ? "Monitorear" : "+ Monitorear"}
    </button>
  );
}

export function KeywordView({
  data,
  onMonitored,
}: {
  data: KeywordOverviewView;
  onMonitored: () => void;
}) {
  const d = data;
  const trend = d.tracked?.seriesPoints ?? [];
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);

  async function handleMonitor(keyword: string) {
    if (pending) return;
    setPending(keyword);
    const res = await fetch("/api/intel/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    }).catch(() => null);
    setPending(null);
    if (res?.ok) {
      setAdded((prev) => new Set(prev).add(keyword.toLowerCase()));
      onMonitored();
    }
  }

  const queryMonitored = Boolean(d.tracked) || added.has(d.query.toLowerCase());

  return (
    <section className="space-y-4" aria-label={`Análisis de ${d.query}`}>
      {/* Cabecera */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight">
          <Search className="h-4 w-4 shrink-0 text-brand-text" />
          <span className="truncate" title={d.query}>{d.query}</span>
        </h2>
        <IntentBadge intent={d.intent} />
        {d.tracked && (
          <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-text-2">
            monitoreado: {d.tracked.name}
          </span>
        )}
        <MonitorButton
          keyword={d.query}
          already={queryMonitored}
          pending={pending === d.query}
          onMonitor={(kw) => void handleMonitor(kw)}
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Dificultad (proxy DENUE)" hint={d.difficulty.formula}>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums" style={{ color: bandColor(d.difficulty.band) }}>
              {d.difficulty.score}
            </span>
            <span className="text-xs font-medium capitalize text-text-2">{d.difficulty.band}</span>
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {d.difficulty.factors.map((f) => (
              <li key={f.label} className="flex items-center gap-1 text-[10px] text-text-3" title={f.raw}>
                <span className="truncate">{f.label}</span>
                <span className="shrink-0 font-medium">{f.weightPct}% · {f.factorScore}</span>
              </li>
            ))}
            {d.difficulty.factors.length === 0 && (
              <li className="text-[10px] text-text-3">Sin DENUE — dificultad no disponible</li>
            )}
          </ul>
        </StatCard>
        <StatCard label="Oferta local (DENUE)" hint={d.competition?.censored ? "censurado: ≥10" : "establecimientos coincidentes"}>
          <p className="text-2xl font-semibold tabular-nums">
            {d.competition === null
              ? "—"
              : d.competition.censored
                ? `≥${d.competition.establishments}`
                : numberCompact.format(d.competition.establishments)}
          </p>
        </StatCard>
        <StatCard label="Interés GT" hint={d.tracked ? "índice Google Trends del nicho" : "sin serie GT para esta keyword"}>
          {d.tracked ? (
            <>
              <p className="text-2xl font-semibold tabular-nums">
                {numberCompact.format(d.tracked.seriesPoints.at(-1)?.value ?? 0)}
              </p>
              {d.tracked.z !== null && (
                <p className="text-[11px] text-text-3">z-score 7d vs 21d: {p1.format(d.tracked.z)}</p>
              )}
            </>
          ) : (
            <p className="text-2xl font-semibold text-text-3">—</p>
          )}
        </StatCard>
      </div>

      {/* Historial GT */}
      {trend.length >= 2 && (
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <h3 className="text-xs font-semibold text-text-2">Interés GT · {d.tracked?.name} (30 días, MX)</h3>
          <div className="mt-2" aria-hidden="true">
            <DottedAreaChart
              data={trend}
              xKey="day"
              series={[{ key: "value", color: "var(--chart-2)" }]}
              yFormatter={(v) => numberCompact.format(v)}
            />
          </div>
          <p className="mt-1 text-[11px] text-text-3">
            Unidad: índice de interés de búsqueda de Google Trends (0–100, MX). Fuente externa.
            El historial empieza en la primera captura; no hay datos retroactivos.
          </p>
        </div>
      )}

      {/* Relacionadas + preguntas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
            <Gauge className="h-3.5 w-3.5 text-brand-text" />
            <h3 className="text-xs font-semibold">Palabras relacionadas</h3>
            <span className="text-[11px] text-text-3">(autocompletado · es-MX)</span>
          </div>
          {d.related.length === 0 ? (
            <p className="px-4 py-3 text-sm text-text-2">Sin sugerencias disponibles por ahora.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-text-3">
                  <th className="px-4 py-1.5 font-medium">Keyword</th>
                  <th className="px-4 py-1.5 font-medium">Intención</th>
                  <th className="px-4 py-1.5 text-right font-medium">Índice GT</th>
                  <th className="px-4 py-1.5 text-right font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {d.related.map((r) => (
                  <tr key={r.keyword} className="border-t">
                    <td className="max-w-[170px] truncate px-4 py-1.5" title={r.keyword}>{r.keyword}</td>
                    <td className="px-4 py-1.5"><IntentBadge intent={r.intent} /></td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-text-2">
                      {r.tracked ? numberCompact.format(r.tracked.lastValue) : "—"}
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <MonitorButton
                        compact
                        keyword={r.keyword}
                        already={Boolean(r.tracked) || added.has(r.keyword.toLowerCase())}
                        pending={pending === r.keyword}
                        onMonitor={(kw) => void handleMonitor(kw)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
            <HelpCircle className="h-3.5 w-3.5 text-brand-text" />
            <h3 className="text-xs font-semibold">Preguntas de los usuarios</h3>
            <span className="text-[11px] text-text-3">(oportunidad de contenido)</span>
          </div>
          {d.questions.length === 0 ? (
            <p className="px-4 py-3 text-sm text-text-2">Sin preguntas detectadas en las sugerencias.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5 p-3">
              {d.questions.map((q) => (
                <li key={q}>
                  <span className="inline-block rounded-full border bg-subtle px-2.5 py-1 text-xs text-text-2">{q}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Método */}
      <p className="rounded-md bg-subtle p-3 text-[11px] leading-snug text-text-2">
        <span className="font-semibold">Método: </span>
        la dificultad es un PROXY propio basado solo en DENUE (no la KD pagada de otra suite):
        {d.difficulty.formula}. Relacionadas y preguntas provienen del autocompletado público
        de Google (es-MX). Interés: Google Trends (MX). Fuentes: {d.sources.join(" · ")}.
      </p>
    </section>
  );
}
