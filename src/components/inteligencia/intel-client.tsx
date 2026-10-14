"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, GitCompareArrows, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendCard } from "@/components/inteligencia/trend-card";
import { ReportView, type SearchReport } from "@/components/inteligencia/report-view";
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
    <article className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-text-3">{hint}</p>}
    </article>
  );
}

/**
 * Módulo de inteligencia — panel de búsqueda de tendencias.
 * Estado 1: KPIs + share Nielsen + audiencia + tarjetas con comparativa.
 * Estado 2: informe de búsqueda (actualiza el panel) o comparativa de nichos.
 */
export function IntelClient() {
  const [trends, setTrends] = useState<TrendsPayload | null>(null);
  const [report, setReport] = useState<SearchReport | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareItems, setCompareItems] = useState<CompareItem[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [query, setQuery] = useState("");
  const [loadingTrends, setLoadingTrends] = useState(true);
  const [searching, setSearching] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState("");

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
    setReport(null);
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

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError("");
    setReport(null);
    setCompareItems(null);
    const res = await fetch(`/api/intel/search?q=${encodeURIComponent(q)}`, { cache: "no-store" }).catch(() => null);
    setSearching(false);
    if (res?.ok) {
      const data = await res.json().catch(() => null) as SearchReport | null;
      if (data) setReport(data);
    } else {
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo generar el informe.");
    }
  }

  function handleClear() {
    setReport(null);
    setQuery("");
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

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <BarChart3 className="h-5 w-5 text-brand-text" /> Inteligencia
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-2">
            Compara nichos, busca una idea y mide su relevancia con datos públicos de México
            (YouTube + DENUE/INEGI). Cada gráfica indica su unidad y fuente.
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

      <form onSubmit={(e) => void handleSearch(e)} className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca una idea: cámaras de seguridad, pc gamer, starlink…"
            className="pl-9"
            aria-label="Buscar una idea"
          />
        </div>
        <Button type="submit" disabled={searching || !query.trim()}>
          {searching ? "Analizando…" : "Buscar"}
        </Button>
        {report && (
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

      {report ? (
        <ReportView report={report} />
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
