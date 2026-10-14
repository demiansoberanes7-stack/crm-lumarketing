"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Gauge, HelpCircle, Search } from "lucide-react";

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
  transaccional: { label: "Transaccional", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  comercial: { label: "Comercial", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  informativo: { label: "Informativo", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  navegacional: { label: "Navegacional", cls: "bg-violet-50 text-violet-700 border-violet-200" },
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
  if (band === "baja") return "#12b886";
  if (band === "media") return "#f59f00";
  if (band === "alta") return "#fa5252";
  return "#c92a2a";
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function StatCard({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <article className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</p>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] leading-snug text-text-3">{hint}</p>}
    </article>
  );
}

export function KeywordView({ data }: { data: KeywordOverviewView }) {
  const d = data;
  const trend = d.tracked?.seriesPoints ?? [];

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
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <h3 className="text-xs font-semibold text-text-2">Interés histórico · {d.tracked?.name} (28 días)</h3>
          <div className="mt-2 h-44" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} width={44} />
                <Tooltip formatter={(v) => (v == null ? "—" : `${numberCompact.format(Number(v))} vistas`)} labelFormatter={(l) => `Día ${l}`} />
                <Area type="monotone" dataKey="value" stroke="#4c6ef5" fill="#4c6ef5" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
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
                </tr>
              </thead>
              <tbody>
                {d.related.map((r) => (
                  <tr key={r.keyword} className="border-t">
                    <td className="max-w-[200px] truncate px-4 py-1.5" title={r.keyword}>{r.keyword}</td>
                    <td className="px-4 py-1.5"><IntentBadge intent={r.intent} /></td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-text-2">
                      {r.tracked ? numberCompact.format(r.tracked.lastValue) : "—"}
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
