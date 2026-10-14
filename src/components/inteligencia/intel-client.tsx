"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendCard } from "@/components/inteligencia/trend-card";
import { ReportView, type SearchReport } from "@/components/inteligencia/report-view";

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

/**
 * Módulo de inteligencia con panel de dos estados:
 * - Estado 1 (default): tarjetas de tendencias actuales.
 * - Estado 2: al buscar, el mismo panel muestra el informe de la idea.
 * "× Limpiar" vuelve al Estado 1.
 */
export function IntelClient() {
  const [trends, setTrends] = useState<TrendsPayload | null>(null);
  const [report, setReport] = useState<SearchReport | null>(null);
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

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError("");
    setReport(null);
    const res = await fetch(`/api/intel/search?q=${encodeURIComponent(q)}`, {
      cache: "no-store",
    }).catch(() => null);
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
            Tendencias de contenido y reportes de ideas con datos públicos (YouTube México + DENUE/INEGI).
            Busca una idea y el panel se actualiza con su informe.
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
      ) : (
        <section aria-label="Tendencias actuales" className="space-y-3">
          {loadingTrends ? (
            <p className="rounded-xl border bg-card p-5 text-sm text-text-2 shadow-sm">Consultando tendencias…</p>
          ) : trends && trends.trends.length > 0 ? (
            <>
              <h2 className="text-sm font-semibold tracking-tight text-text-2">
                Tendencias actuales · México · últimos 28 días
              </h2>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {trends.trends.map((trend) => (
                  <TrendCard key={trend.termId} trend={trend} />
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
      )}
    </div>
  );
}
