"use client";

import { useState } from "react";
import { Check, Gauge, HelpCircle, Plus, Search, Sparkles } from "lucide-react";
import { DottedAreaChart } from "@/components/ui/chart";
import { GtRegionPanel } from "@/components/inteligencia/gt-region-panel";

/**
 * Overview de palabra clave estilo SEMrush: fuentes 100 % externas.
 * KPIs (dificultad DENUE + interés GT EN VIVO de la consulta), relacionadas
 * (autocompletado público de Google), preguntas y —anidado y etiquetado— el
 * historial del nicho del catálogo que se parece a la búsqueda.
 */

type Intent = "transaccional" | "comercial" | "informativo" | "navegacional";
type MarketRelated = { label: string; value: number; pct: number | null; isBreakout: boolean; list: "top" | "rising" };

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
    niche: { name: string; score: number } | null;
    tracked: { lastValue: number } | null;
  }>;
  questions: string[];
  /** Nicho del catálogo parecido a la consulta: se muestra ANIDADO y etiquetado. */
  tracked: {
    termId: string;
    name: string;
    classification: "A" | "B" | "C" | "D";
    z: number | null;
    seriesPoints: Array<{ day: string; value: number }>;
    matchScore: number;
    matchedVia: string;
  } | null;
  /** Google Trends en vivo de la consulta buscada. */
  market: {
    series: Array<{ day: string; value: number }>;
    regions: Array<{ state: string; index: number }>;
    topics: Array<{ label: string; value: number; pct: number | null; isBreakout: boolean; list: "top" | "rising" }>;
    queries: Array<{ label: string; value: number; pct: number | null; isBreakout: boolean; list: "top" | "rising" }>;
    provider: "serpapi" | "apify" | "web";
    sourceLabel: string;
    window: string;
    partial: boolean;
  } | null;
  marketNote: string | null;
  /**
   * Nichos del catálogo ordenados por parecido a la consulta (los que no cruzan
   * el umbral también vienen, con su porcentaje). Alimenta el ranking, la
   * comparativa y el mapa para que se lean como contexto de ESTA búsqueda.
   */
  catalogMatches: Array<{
    termId: string;
    name: string;
    /** Keywords del nicho; opcional para no romper respuestas antiguas en caché. */
    keywords?: string[];
    score: number;
    via: string;
    exact: boolean;
  }>;
  sources: string[];
  generatedAt: string;
};

const numberCompact = new Intl.NumberFormat("es-MX", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const p1 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

const CLS_LABEL: Record<"A" | "B" | "C" | "D", string> = {
  A: "A · crece",
  B: "B · estable",
  C: "C · contrae",
  D: "D · sin datos",
};

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

function MarketRelatedCard({
  icon: Icon,
  title,
  items,
  added,
  pending,
  onMonitor,
}: {
  icon: typeof Sparkles;
  title: string;
  items: MarketRelated[];
  added: Set<string>;
  pending: string | null;
  onMonitor: (keyword: string) => void;
}) {
  const top = items
    .filter((i) => i.list === "top")
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const rising = items
    .filter((i) => i.list === "rising")
    .sort((a, b) => (b.pct ?? Number.MAX_SAFE_INTEGER) - (a.pct ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 4);
  const rows = [...top, ...rising];
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
        <Icon className="h-3.5 w-3.5 text-brand-text" />
        <h3 className="text-xs font-semibold">{title}</h3>
        <span className="text-[11px] text-text-3">(Google Trends)</span>
      </div>
      <ul className="divide-y">
        {rows.map((item) => (
          <li key={`${item.list}|${item.label}`} className="flex items-center gap-2 px-4 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate" title={item.label}>{item.label}</span>
            {item.isBreakout ? (
              <span className="shrink-0 rounded bg-success-tint px-1.5 py-0.5 text-[10px] font-medium text-success-text">Aumento puntual</span>
            ) : item.list === "rising" ? (
              <span className="shrink-0 font-medium tabular-nums text-success-text">{item.pct === null ? "—" : `+${item.pct}%`}</span>
            ) : (
              <span className="w-7 shrink-0 text-right font-medium tabular-nums text-text-2">{item.value}</span>
            )}
            <MonitorButton
              compact
              keyword={item.label}
              already={added.has(item.label.toLowerCase())}
              pending={pending === item.label}
              onMonitor={onMonitor}
            />
          </li>
        ))}
      </ul>
    </div>
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
  /** Solo la serie EN VIVO de la consulta; la del nicho va en su propio bloque. */
  const trend = d.market?.series ?? [];
  const lastInterest = trend.at(-1)?.value ?? null;
  const gtSource = d.market?.sourceLabel ?? null;
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
          <span
            className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-text-2"
            title={`Tu búsqueda se parece a «${d.tracked.matchedVia}», un nicho que ya monitoreas. Arriba van los datos EN VIVO de tu búsqueda.`}
          >
            nicho relacionado: {d.tracked.name} · {Math.round(d.tracked.matchScore * 100)}%
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
            <span className="text-2xl font-semibold tabular-nums" style={{ color: d.difficulty.factors.length ? bandColor(d.difficulty.band) : "var(--text-3)" }}>
              {d.difficulty.factors.length ? d.difficulty.score : "—"}
            </span>
            {d.difficulty.factors.length > 0 && (
              <span className="text-xs font-medium capitalize text-text-2">{d.difficulty.band}</span>
            )}
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
        <StatCard
          label="Interés GT"
          hint={
            gtSource
              ? `último valor en vivo · ${gtSource}`
              : d.marketNote ?? "sin serie GT en vivo para esta búsqueda"
          }
        >
          {lastInterest !== null ? (
            <p className="text-2xl font-semibold tabular-nums">
              {numberCompact.format(lastInterest)}
            </p>
          ) : (
            <p className="text-2xl font-semibold text-text-3">—</p>
          )}
        </StatCard>
      </div>

      {d.marketNote && (
        <p className="rounded-md border bg-subtle p-3 text-[11px] leading-snug text-text-2">
          <span className="font-semibold">Google Trends: </span>{d.marketNote}
        </p>
      )}

      {/* Interés GT EN VIVO de la consulta buscada */}
      {trend.length >= 2 && (
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <h3 className="text-xs font-semibold text-text-2">
            Interés GT en vivo · {d.query} ({d.market?.window ?? "30 días"}, MX)
          </h3>
          <div className="mt-2" aria-hidden="true">
            <DottedAreaChart
              data={trend}
              xKey="day"
              series={[{ key: "value", color: "var(--chart-2)" }]}
              yFormatter={(v) => numberCompact.format(v)}
            />
          </div>
          <p className="mt-1 text-[11px] text-text-3">
            Unidad: índice de interés de búsqueda de Google Trends (0–100, MX). Fuente externa:
            {" "}{gtSource ?? "Google Trends"}.
          </p>
        </div>
      )}

      {/*
        Bloque ANIDADO: serie cacheada del nicho monitoreado que se parece a la
        consulta. Va separado y etiquetado para que nadie confunda la tendencia
        buscada con el historial de otro tema.
      */}
      {d.tracked && (
        <div className="rounded-xl border-l-4 border-l-brand bg-card p-4 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold text-text-2">Nicho de tu catálogo relacionado</h3>
            <span className="rounded-full border border-brand-soft bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-text">
              {d.tracked.name}
            </span>
            <span
              className="text-[11px] text-text-3"
              title={`Coincidió con «${d.tracked.matchedVia}» del catálogo`}
            >
              {Math.round(d.tracked.matchScore * 100)}% parecida a «{d.query}» · serie del nicho, no de tu búsqueda
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-text-3">Clase</dt>
              <dd className="font-medium">{CLS_LABEL[d.tracked.classification]}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-text-3">z-score 7d vs 21d</dt>
              <dd className="font-medium tabular-nums">
                {d.tracked.z === null || d.tracked.z === undefined ? "—" : p1.format(d.tracked.z)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-text-3">Índice actual</dt>
              <dd className="font-medium tabular-nums">
                {d.tracked.seriesPoints.length === 0
                  ? "—"
                  : numberCompact.format(d.tracked.seriesPoints.at(-1)?.value ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-text-3">Coincidió vía</dt>
              <dd className="truncate font-medium" title={d.tracked.matchedVia}>{d.tracked.matchedVia}</dd>
            </div>
          </dl>
          {d.tracked.seriesPoints.length >= 2 && (
            <div className="mt-3" aria-hidden="true">
              <DottedAreaChart
                data={d.tracked.seriesPoints}
                xKey="day"
                series={[{ key: "value", color: "var(--chart-3)" }]}
                yFormatter={(v) => numberCompact.format(v)}
              />
            </div>
          )}
          <p className="mt-1 text-[11px] text-text-3">
            Fuente: ingesta programada de Google Trends para el término «{d.tracked.name}».
            Si buscaste otra cosa, esta serie NO corresponde a tu consulta.
          </p>
        </div>
      )}

      {/* Interés por subregión de la consulta buscada */}
      {d.market && d.market.regions.length > 0 && (
        <GtRegionPanel
          regions={d.market.regions.map((r) => ({ ...r, source: "google_trends" as const }))}
          regionsSource="google_trends"
          termName={d.query}
        />
      )}

      {/* Temas y consultas relacionados según Google Trends */}
      {d.market && (d.market.topics.length > 0 || d.market.queries.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <MarketRelatedCard
            icon={Sparkles}
            title="Temas en Google Trends"
            items={d.market.topics}
            added={added}
            pending={pending}
            onMonitor={(kw) => void handleMonitor(kw)}
          />
          <MarketRelatedCard
            icon={Search}
            title="Consultas en Google Trends"
            items={d.market.queries}
            added={added}
            pending={pending}
            onMonitor={(kw) => void handleMonitor(kw)}
          />
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
                      {r.niche && (
                        <span className="block text-[10px] font-normal text-text-3" title={`El índice viene del nicho monitoreado «${r.niche.name}»`}>
                          {r.niche.name}
                        </span>
                      )}
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
        de Google (es-MX). Interés, subregiones y temas/consultas: Google Trends (MX) consultados
        EN VIVO para esta búsqueda; la serie de un nicho de tu catálogo sólo aparece en el bloque
        «Nicho de tu catálogo relacionado», nunca mezclada con los datos de tu consulta. Si una
        fuente no responde, el campo queda en «—» y se indica el motivo; no se rellena con
        datos inventados. Fuentes: {d.sources.join(" · ")}.
      </p>
    </section>
  );
}
