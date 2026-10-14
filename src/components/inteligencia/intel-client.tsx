"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, GitCompareArrows, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendCard } from "@/components/inteligencia/trend-card";
import { KeywordView, type KeywordOverviewView } from "@/components/inteligencia/keyword-view";
import { ShareBars } from "@/components/inteligencia/share-bars";
import { AudiencePanel } from "@/components/inteligencia/audience-panel";
import { GeoPanel } from "@/components/inteligencia/geo-panel";
import { FunnelPanel } from "@/components/inteligencia/funnel-panel";
import { ContentPanel } from "@/components/inteligencia/content-panel";
import { CompareView, type CompareItem } from "@/components/inteligencia/compare-view";

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

/**
 * Módulo de inteligencia — motor de búsqueda de palabras clave estilo
 * SEMrush con autocompletado, más el tablero (share, audiencia, geografía,
 * embudo, contenidos) debajo del overview.
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
      if (data) setOverview(data);
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
    // Retrasa el cierre para permitir el click en una sugerencia.
    blurTimer.current = setTimeout(() => setShowSuggest(false), 150);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <BarChart3 className="h-5 w-5 text-brand-text" /> Inteligencia
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-2">
            Analiza cualquier palabra clave: intención, dificultad, palabras relacionadas,
            preguntas y el SERP real de YouTube en México.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {trends?.lastIngestAt && (
            <span className="text-xs text-text-3">
              Datos al {new Date(trends.lastIngestAt).toLocaleString("es-MX")}
            </span>
          )}
          <Button variant="outline" onClick={() => void handleIngest()} disabled={ingesting}>
            <RefreshCw className={`mr-2 h-4 w-4 ${ingesting ? "animate-spin" : ""}`} />
            {ingesting ? "Actualizando…" : "Actualizar datos"}
          </Button>
        </div>
      </header>

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

      {error && (
        <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
          {error}
        </p>
      )}

      {overview ? (
        <KeywordView data={overview} onMonitored={() => void loadTrends()} />
      ) : compareItems ? (
        <CompareView items={compareItems} onRemove={toggleSelect} onClear={clearCompare} />
      ) : (
        <>
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

          <FunnelPanel />

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
  );
}
