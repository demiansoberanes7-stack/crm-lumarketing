"use client";

import { useState } from "react";
import { Check, Gauge, HelpCircle, Plus, Search } from "lucide-react";
import { DottedAreaChart } from "@/components/ui/chart";

/**
 * Overview de palabra clave estilo SEMrush: métricas arriba, historial,
 * palabras relacionadas con intención, preguntas y SERP real. Cada bloque
 * declara su fuente y su unidad; la dificultad muestra su fórmula abierta.
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
  totalResults: number | null;
  competition: { establishments: number; censored: boolean } | null;
  related: Array<{
    keyword: string;
    intent: Intent;
    tracked: { lastValue: number } | null;
  }>;
  questions: string[];
  serp: Array<{
    position: number;
    videoId: string;
    title: string;
    channelTitle: string | null;
    views: number;
    engagementPct: number | null;
    durationSeconds: number | null;
    publishedAt: string | null;
    pattern: string;
  }>;
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

function fmtDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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
      title="Agregar al catálogo: entra al share y a las tendencias"
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Dificultad (proxy)" hint={d.difficulty.formula}>
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
          </ul>
        </StatCard>
        <StatCard label="Contenido en YouTube" hint="videos que coinciden en el SERP (saturación)">
          <p className="text-2xl font-semibold tabular-nums">
            {d.totalResults === null ? "—" : numberCompact.format(d.totalResults)}
          </p>
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
        <StatCard label="Interés medido" hint={d.tracked ? "vistas del último feed del nicho" : "sin serie histórica para esta keyword"}>
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

      {/* Historial */}
      {trend.length >= 2 && (
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <h3 className="text-xs font-semibold text-text-2">Interés histórico · {d.tracked?.name} (28 días)</h3>
          <div className="mt-2" aria-hidden="true">
            <DottedAreaChart
              data={trend}
              xKey="day"
              series={[{ key: "value", color: "var(--chart-2)" }]}
              yFormatter={(v) => numberCompact.format(v)}
            />
          </div>
          <p className="mt-1 text-[11px] text-text-3">
            Unidad: vistas acumuladas del feed popular que coinciden con el nicho (YouTube MX).
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
                  <th className="px-4 py-1.5 text-right font-medium">Interés</th>
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

      {/* SERP */}
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <div className="flex items-baseline justify-between gap-2 border-b px-4 py-2.5">
          <h3 className="text-xs font-semibold">Top resultados en YouTube (SERP real, MX)</h3>
          {d.totalResults !== null && (
            <span className="text-[11px] text-text-3">de {numberCompact.format(d.totalResults)} videos</span>
          )}
        </div>
        {d.serp.length === 0 ? (
          <p className="px-4 py-3 text-sm text-text-2">
            Sin resultados — revisa la API key de YouTube en Conexiones → Inteligencia.
          </p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-[11px] text-text-3">
                <th className="px-4 py-1.5 font-medium">#</th>
                <th className="px-4 py-1.5 font-medium">Título</th>
                <th className="px-4 py-1.5 font-medium">Canal</th>
                <th className="px-4 py-1.5 text-right font-medium">Vistas</th>
                <th className="px-4 py-1.5 text-right font-medium">Eng %</th>
                <th className="px-4 py-1.5 text-right font-medium">Duración</th>
                <th className="px-4 py-1.5 font-medium">Estilo</th>
              </tr>
            </thead>
            <tbody>
              {d.serp.map((v) => (
                <tr key={v.videoId} className="border-t">
                  <td className="px-4 py-1.5 tabular-nums text-text-3">{v.position}</td>
                  <td className="max-w-[240px] truncate px-4 py-1.5" title={v.title}>
                    <a
                      href={`https://www.youtube.com/watch?v=${v.videoId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {v.title}
                    </a>
                  </td>
                  <td className="max-w-[130px] truncate px-4 py-1.5 text-[12px] text-text-2">{v.channelTitle ?? "—"}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{numberCompact.format(v.views)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">
                    {v.engagementPct === null ? "—" : `${p1.format(v.engagementPct)}%`}
                  </td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fmtDuration(v.durationSeconds)}</td>
                  <td className="px-4 py-1.5 text-[11px] text-text-3">{v.pattern}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Método */}
      <p className="rounded-md bg-subtle p-3 text-[11px] leading-snug text-text-2">
        <span className="font-semibold">Método: </span>
        la dificultad es un PROXY propio y transparente (no la métrica pagada de otra suite):
        {d.difficulty.formula}. Eng % = likes/vistas × 100. Relacionadas y preguntas provienen
        del autocompletado público de Google (es-MX; puede variar y está sujeto a cambios del
        servicio). SERP = resultados de búsqueda de YouTube con geolocalización MX.
        Fuentes: {d.sources.join(" · ")}.
      </p>
    </section>
  );
}
