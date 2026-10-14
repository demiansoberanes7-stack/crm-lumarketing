"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Clock,
  GitCompareArrows,
  LayoutGrid,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendCard } from "@/components/inteligencia/trend-card";
import { KeywordView, type KeywordOverviewView } from "@/components/inteligencia/keyword-view";
import { ShareBars } from "@/components/inteligencia/share-bars";
import { AudiencePanel } from "@/components/inteligencia/audience-panel";
import { GeoPanel } from "@/components/inteligencia/geo-panel";
import { ContentPanel } from "@/components/inteligencia/content-panel";
import { CompareView, type CompareItem } from "@/components/inteligencia/compare-view";
import { GtRegionPanel } from "@/components/inteligencia/gt-region-panel";
import { GtRelatedPanel } from "@/components/inteligencia/gt-related-panel";
import { GtCompareChart, GtRanking, buildRanking } from "@/components/inteligencia/gt-ranking";

/* ── Tipos ───────────────────────────────────────────────────────────────── */

type TrendsPayload = {
  trends: Array<{
    termId: string;
    name: string;
    z: number | null;
    lastValue: number;
    lastVideoCount: number;
    series: Array<{ day: string; value: number }>;
  }>;
  lastIngestAt: string | null;
};

type GtReport = {
  termId: string;
  termName: string;
  series: Array<{ day: string; value: number }>;
  seriesSource: "google_trends" | "youtube_fallback" | "none";
  regions: Array<{ state: string; index: number; source: "google_trends" | "denue" }>;
  regionsSource: "google_trends" | "denue" | "none";
  topics: Array<{ label: string; value: number; pct: number | null; isBreakout: boolean }>;
  queries: Array<{ label: string; value: number; pct: number | null; isBreakout: boolean }>;
  usedFallback: boolean;
  method: { fuente: string; ventana: string };
  generatedAt: string;
};

const numberCompact = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="stat-card min-w-0 rounded-xl border bg-card p-4 shadow-xs">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-text-3">{hint}</p>}
    </article>
  );
}

/* ── Componente principal ────────────────────────────────────────────────── */

/**
 * Módulo de inteligencia. Vista principal = layout estilo Google Trends
 * (chip de término, filtros, serie 0–100, subregiones, temas/consultas).
 * Pestaña «Overview» = el motor SEMrush (keyword-view) + tablero completo.
 */
export function IntelClient() {
  const [trends, setTrends] = useState<TrendsPayload | null>(null);
  const [overview, setOverview] = useState<KeywordOverviewView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareItems, setCompareItems] = useState<CompareItem[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [loadingTrends, setLoadingTrends] = useState(true);
  const [searching, setSearching] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState("");
  const suggestSeq = useRef(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pestana activa: "gt" (vista principal) u "overview" (SEMrush + tablero).
  const [tab, setTab] = useState<"gt" | "overview">("gt");

  // Selección de término para el reporte GT.
  const [activeTermId, setActiveTermId] = useState<string>("");
  const [gtReport, setGtReport] = useState<GtReport | null>(null);

  const loadTrends = useCallback(async () => {
    setLoadingTrends(true);
    setError("");
    const res = await fetch("/api/intel/trends", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as TrendsPayload | null;
      setTrends(data);
    } else {
      setError("No se pudieron cargar las tendencias.");
    }
    setLoadingTrends(false);
  }, []);

  useEffect(() => { void loadTrends(); }, [loadTrends]);

  // Selecciona el primer término por defecto para GT.
  useEffect(() => {
    if (!activeTermId && trends?.trends.length) {
      setActiveTermId(trends.trends[0]!.termId);
    }
  }, [trends, activeTermId]);

  // Carga el reporte GT cuando cambia el término activo.
  const loadGt = useCallback(async (termId: string) => {
    if (!termId) return;
    const res = await fetch(`/api/intel/gt?termId=${encodeURIComponent(termId)}`, {
      cache: "no-store",
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as GtReport | null;
      setGtReport(data);
    } else {
      setGtReport(null);
    }
  }, []);

  useEffect(() => { void loadGt(activeTermId); }, [activeTermId, loadGt]);

  // Autocompletado con debounce (estilo SEMrush): mientras el usuario escribe.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const seq = ++suggestSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        const res = await fetch(`/api/intel/suggest?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        }).catch(() => null);
        if (seq !== suggestSeq.current) return;
        if (res?.ok) {
          const data = await res.json().catch(() => null) as { suggestions?: string[] } | null;
          setSuggestions(data?.suggestions ?? []);
          setShowSuggest(true);
        }
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const shareRows = useMemo(() => {
    if (!trends) return [];
    const total = trends.trends.reduce((a, t) => a + t.lastValue, 0);
    return trends.trends
      .filter((t) => t.lastValue > 0)
      .map((t) => ({
        name: t.name,
        views: t.lastValue,
        pct: total > 0 ? (t.lastValue / total) * 100 : 0,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [trends]);

  const kpis = useMemo(() => {
    if (!trends) return null;
    const totalViews = trends.trends.reduce((a, t) => a + t.lastValue, 0);
    const totalVideos = trends.trends.reduce((a, t) => a + t.lastVideoCount, 0);
    return { niches: trends.trends.length, totalViews, totalVideos };
  }, [trends]);

  const geoTerms = useMemo(
    () => trends?.trends.map((t) => ({ id: t.termId, name: t.name })) ?? [],
    [trends]
  );

  // Serie para la gráfica GT (con suavizado MA7, sin alterar el dato crudo).
  // (Se eliminó: la pestaña Tendencias ahora usa el ranking + comparativa multi-nicho.)

  function toggleSelect(termId: string) {
    setCompareItems(null);
    setSelected((prev) => {
      if (prev.includes(termId)) return prev.filter((id) => id !== termId);
      if (prev.length >= 3) return prev;
      return [...prev, termId];
    });
  }

  async function handleCompare() {
    if (selected.length < 2) return;
    setComparing(true);
    setError("");
    setOverview(null);
    const res = await fetch(`/api/intel/compare?ids=${selected.join(",")}`, { cache: "no-store" }).catch(() => null);
    setComparing(false);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as { terms: CompareItem[] } | null;
      if (data) setCompareItems(data.terms);
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo generar la comparativa.");
    }
  }

  function clearCompare() {
    setCompareItems(null);
    setSelected([]);
  }

  async function runSearch(q: string) {
    const term = q.trim();
    if (!term) return;
    setSearching(true);
    setError("");
    setOverview(null);
    setCompareItems(null);
    setShowSuggest(false);
    const res = await fetch(`/api/intel/keyword?q=${encodeURIComponent(term)}`, {
      cache: "no-store",
    }).catch(() => null);
    setSearching(false);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as KeywordOverviewView | null;
      if (data) {
        setOverview(data);
        setTab("overview");
      }
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo analizar la palabra clave.");
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    void runSearch(query);
  }

  function pickSuggestion(s: string) {
    setQuery(s);
    void runSearch(s);
  }

  function handleClear() {
    setOverview(null);
    setQuery("");
    setSuggestions([]);
    setError("");
  }

  async function handleIngest() {
    setIngesting(true);
    setError("");
    const res = await fetch("/api/intel/ingest", { method: "POST" }).catch(() => null);
    setIngesting(false);
    if (res?.ok) {
      clearCompare();
      await loadTrends();
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo actualizar el feed de datos.");
    }
  }

  function onSuggestFocus() {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    if (suggestions.length > 0) setShowSuggest(true);
  }

  function onSuggestBlur() {
    blurTimer.current = setTimeout(() => setShowSuggest(false), 150);
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <BarChart3 className="h-5 w-5 text-brand-text" /> Inteligencia
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-2">
            Tendencias de búsqueda en México: interés relativo (0–100), subregiones y
            temas/consultas relacionados. Fuente primaria Google Trends; fallback a YouTube.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {trends?.lastIngestAt && (
            <span className="flex items-center gap-1 text-xs text-text-3">
              <Clock className="h-3 w-3" />
              Datos al {new Date(trends.lastIngestAt).toLocaleString("es-MX")}
            </span>
          )}
          <Button variant="outline" onClick={() => void handleIngest()} disabled={ingesting}>
            <RefreshCw className={`mr-2 h-4 w-4 ${ingesting ? "animate-spin" : ""}`} />
            {ingesting ? "Actualizando…" : "Actualizar datos"}
          </Button>
        </div>
      </header>

      {/* Pestañas: GT (principal) u Overview (SEMrush + tablero). */}
      <div className="flex gap-1 rounded-md bg-subtle p-0.5" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "gt"}
          onClick={() => { setTab("gt"); handleClear(); }}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "gt" ? "bg-card shadow-xs" : "text-text-2 hover:text-foreground"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" /> Tendencias
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "overview"}
          onClick={() => setTab("overview")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "overview" ? "bg-card shadow-xs" : "text-text-2 hover:text-foreground"
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" /> Overview
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
          {error}
        </p>
      )}

      {tab === "gt" ? (
        <>
          {/* Ranking accionable: qué nichos conviene atacar */}
          {trends && trends.trends.length > 0 && (
            <GtRanking ranking={buildRanking(trends.trends)} />
          )}

          {/* Gráfica comparativa multi-nicho (todas las líneas normalizadas) */}
          {trends && trends.trends.length > 0 && (
            <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Comparativa multi-nicho">
              <h2 className="font-semibold">Interés comparado · últimos 28 días</h2>
              <p className="mt-1 text-xs text-text-3">
                Cada nicho normalizado a su propio máximo (0–100). Sirve para ver de un
                vistazo cuáles suben y cuáles bajan. Fuente: Google Trends (MX) cuando hay
                datos; si no, YouTube mostPopular.
              </p>
              <div className="mt-3">
                <GtCompareChart trends={trends.trends} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {trends.trends.slice(0, 6).map((t, i) => (
                  <span key={t.termId} className="flex items-center gap-1 text-[11px] text-text-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"][i % 6] }}
                    />
                    {t.name}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Selector de nicho para paneles GT (subregiones, temas) */}
          {trends && trends.trends.length > 0 && gtReport && (gtReport.regionsSource !== "none" || gtReport.topics.length > 0 || gtReport.queries.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-text-2">Ver detalle de:</span>
              <div className="flex flex-wrap gap-1.5">
                {trends.trends.map((t) => (
                  <button
                    key={t.termId}
                    type="button"
                    onClick={() => setActiveTermId(t.termId)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      activeTermId === t.termId
                        ? "border-brand-text bg-brand-tint text-brand-text"
                        : "border-border bg-card text-text-2 hover:border-border/80"
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Subregiones (solo si hay datos GT) */}
          {gtReport && gtReport.regionsSource !== "none" && (
            <GtRegionPanel
              regions={gtReport.regions}
              regionsSource={gtReport.regionsSource}
              termName={gtReport.termName}
            />
          )}

          {/* Temas y consultas (solo si hay datos GT) */}
          {gtReport && (gtReport.topics.length > 0 || gtReport.queries.length > 0) && (
            <GtRelatedPanel topics={gtReport.topics} queries={gtReport.queries} />
          )}

          {/* Cards de tendencia (compatibilidad con el flujo de comparar) */}
          {trends && trends.trends.length > 0 && (
            <section aria-label="Tendencias actuales" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold tracking-tight text-text-2">
                  Detalle por nicho · selecciona para comparar
                </h2>
                <Button
                  onClick={() => void handleCompare()}
                  disabled={selected.length < 2 || comparing}
                  variant={selected.length >= 2 ? "default" : "outline"}
                >
                  <GitCompareArrows className="mr-2 h-4 w-4" />
                  {comparing ? "Comparando…" : `Comparar (${selected.length})`}
                </Button>
              </div>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {trends.trends.map((trend) => (
                  <TrendCard
                    key={trend.termId}
                    trend={trend}
                    selected={selected.includes(trend.termId)}
                    onSelect={() => toggleSelect(trend.termId)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      ) : overview ? (
        <KeywordView data={overview} onMonitored={() => void loadTrends()} />
      ) : compareItems ? (
        <CompareView items={compareItems} onRemove={toggleSelect} onClear={clearCompare} />
      ) : (
        <>
          {/* Buscador SEMrush */}
          <form onSubmit={handleSearch} className="relative flex flex-wrap gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={onSuggestFocus}
                onBlur={onSuggestBlur}
                placeholder="Escribe una keyword: cámaras de seguridad, pc gamer, starlink…"
                className="pl-9"
                aria-label="Palabra clave a analizar"
                autoComplete="off"
              />
              {showSuggest && suggestions.length > 0 && (
                <ul
                  role="listbox"
                  aria-label="Sugerencias"
                  className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border bg-popover p-1 shadow-md"
                >
                  {suggestions.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickSuggestion(s)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <Search className="h-3.5 w-3.5 shrink-0 text-text-3" />
                        <span className="min-w-0 truncate">{s}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button type="submit" disabled={searching || !query.trim()}>
              {searching ? "Analizando…" : "Analizar"}
            </Button>
            {overview && (
              <Button type="button" variant="ghost" onClick={handleClear}>
                <X className="mr-1 h-4 w-4" /> Limpiar
              </Button>
            )}
          </form>

          {kpis && (
            <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Nichos monitoreados" value={String(kpis.niches)} hint="catálogo activo" />
              <StatCard label="Videos del feed" value={numberCompact.format(kpis.totalVideos)} hint="coincidencias del día" />
              <StatCard label="Interés total" value={numberCompact.format(kpis.totalViews)} hint="vistas acumuladas" />
              <StatCard
                label="Comparativa"
                value={`${selected.length}/3`}
                hint={selected.length >= 2 ? "pulsa Comparar" : "selecciona tarjetas"}
              />
            </section>
          )}

          <ShareBars rows={shareRows} />

          <AudiencePanel />

          <GeoPanel terms={geoTerms} />

          <ContentPanel />

          <section aria-label="Tendencias actuales" className="space-y-3">
            {loadingTrends ? (
              <p className="rounded-xl border bg-card p-5 text-sm text-text-2 shadow-sm">Consultando tendencias…</p>
            ) : trends && trends.trends.length > 0 ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold tracking-tight text-text-2">
                    Evolución por nicho · 28 días
                  </h2>
                  <Button
                    onClick={() => void handleCompare()}
                    disabled={selected.length < 2 || comparing}
                    variant={selected.length >= 2 ? "default" : "outline"}
                  >
                    <GitCompareArrows className="mr-2 h-4 w-4" />
                    {comparing ? "Comparando…" : `Comparar (${selected.length})`}
                  </Button>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {trends.trends.map((trend) => (
                    <TrendCard
                      key={trend.termId}
                      trend={trend}
                      selected={selected.includes(trend.termId)}
                      onSelect={() => toggleSelect(trend.termId)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-xl border bg-card p-5 text-sm text-text-2 shadow-sm">
                <p className="font-medium">Aún no hay datos de tendencias.</p>
                <p className="mt-1 text-text-3">
                  Configura la API key de YouTube (Conexiones → Inteligencia) y pulsa
                  «Actualizar datos» para capturar el feed popular del día.
                </p>
              </div>
            )}
          </section>
        </>
      )}
      </div>
    </div>
  );
}
