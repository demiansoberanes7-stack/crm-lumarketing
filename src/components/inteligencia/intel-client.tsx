"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Clock,
  GitCompareArrows,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendCard } from "@/components/inteligencia/trend-card";
import { KeywordView, type KeywordOverviewView } from "@/components/inteligencia/keyword-view";
import { AudiencePanel } from "@/components/inteligencia/audience-panel";
import { GeoPanel } from "@/components/inteligencia/geo-panel";
import { CompareView, type CompareItem } from "@/components/inteligencia/compare-view";
import { GtRegionPanel } from "@/components/inteligencia/gt-region-panel";
import { GtRelatedPanel, type RelatedItem } from "@/components/inteligencia/gt-related-panel";
import { GtCompareChart, GtRanking, buildRanking } from "@/components/inteligencia/gt-ranking";
import { TrendingPanel } from "@/components/inteligencia/trending-panel";
import { ContentPanel } from "@/components/inteligencia/content-panel";
import { pollIntelJob } from "@/lib/intel-jobs-client";

/* ── Tipos ───────────────────────────────────────────────────────────────── */

type TrendsPayload = {
  trends: Array<{
    termId: string;
    name: string;
    z: number | null;
    lastValue: number;
    series: Array<{ day: string; value: number }>;
  }>;
  lastIngestAt: string | null;
  source?: string;
};

type GtReport = {
  termId: string;
  termName: string;
  series: Array<{ day: string; value: number }>;
  seriesSource: "google_trends" | "none";
  regions: Array<{ state: string; index: number; source: "google_trends" | "denue" }>;
  regionsSource: "google_trends" | "denue" | "none";
  topics: RelatedItem[];
  queries: RelatedItem[];
  usedFallback: boolean;
  method: { fuente: string; ventana: string };
  generatedAt: string;
};

/* ── Componente principal ────────────────────────────────────────────────── */

/**
 * Qué escribió realmente la ingesta. Sin este desglose el botón solo diría
 * «listo» y el usuario no sabría si las tendencias o YouTube se llenaron, se
 * cayeron por cuota o simplemente no tienen llave configurada.
 */
function ingestSummary(result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  const partes: string[] = [`${num(r.gtIngested)} nichos de Google Trends`];
  if (num(r.trendingRows) > 0) partes.push(`${r.trendingRows} tendencias actuales`);
  if (num(r.youtubeRows) > 0) partes.push(`${r.youtubeRows} videos de YouTube`);
  else if (r.youtubeReason === "missing_youtube_key") partes.push("YouTube sin API key");
  return `Actualizado: ${partes.join(" · ")}.`;
}

/**
 * Módulo de Inteligencia en una sola columna: todo lo que se consulta vive en
 * el mismo scroll, ordenado de la señal más externa y urgente (qué se busca
 * hoy) a la más propia (nichos monitoreados, contenido, audiencia, competencia
 * local). Sin pestañas: el usuario no tiene que adivinar dónde está el dato.
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
  const [nicheRefreshing, setNicheRefreshing] = useState(false);
  const [ingestProgress, setIngestProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [explore, setExplore] = useState(false);
  const suggestSeq = useRef(0);
  const suggestAbort = useRef<AbortController | null>(null);
  const suggestCache = useRef<Map<string, string[]>>(new Map());
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    // Nada se carga solo: el explorador de nichos solo consulta cuando la
    // persona lo abre. La vista principal es la búsqueda que ella escribe.
    if (explore) void loadTrends();
  }, [explore, loadTrends]);

  useEffect(() => {
    if (!activeTermId && trends?.trends.length) {
      setActiveTermId(trends.trends[0]!.termId);
    }
  }, [trends, activeTermId]);

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

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    // Caché corto en memoria: teclear, borrar y reescribir la misma consulta
    // no vuelve a golpear la red.
    const cached = suggestCache.current.get(q);
    if (cached) {
      setSuggestions(cached);
      setShowSuggest(true);
      return;
    }
    const seq = ++suggestSeq.current;
    const timer = setTimeout(() => {
      suggestAbort.current?.abort();
      const controller = new AbortController();
      suggestAbort.current = controller;
      void (async () => {
        const res = await fetch(`/api/intel/suggest?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: controller.signal,
        }).catch(() => null);
        if (seq !== suggestSeq.current || controller.signal.aborted) return;
        if (res?.ok) {
          const data = await res.json().catch(() => null) as { suggestions?: string[] } | null;
          const list = data?.suggestions ?? [];
          suggestCache.current.set(q, list);
          // Tope del caché: 50 consultas; la más vieja sale primero.
          if (suggestCache.current.size > 50) {
            const oldest = suggestCache.current.keys().next().value;
            if (oldest !== undefined) suggestCache.current.delete(oldest);
          }
          setSuggestions(list);
          setShowSuggest(true);
        }
      })();
    }, 300);
    return () => {
      clearTimeout(timer);
      // Cancelar el request pendiente: la secuencia ya descartaba la
      // respuesta vieja, pero seguía corriendo y gastando cuota.
      suggestAbort.current?.abort();
    };
  }, [query]);

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

  /**
   * Alta de nicho desde cualquier fila externa (tendencias, temas, consultas).
   * Devuelve el mensaje para la propia fila: la creación de dato propio tiene
   * que confirmarse en el sitio donde se pulsó, no arriba.
   */
  const monitorKeyword = useCallback(
    async (keyword: string): Promise<string | null> => {
      const res = await fetch("/api/intel/monitor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyword }),
      }).catch(() => null);
      if (!res?.ok) {
        const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
        return data?.error?.message ?? "No se pudo crear el nicho.";
      }
      const data = await res.json().catch(() => null) as { created?: boolean; name?: string } | null;
      await loadTrends();
      return data?.created
        ? `«${data.name ?? keyword}» ya se monitorea como nicho.`
        : `«${data?.name ?? keyword}» ya estaba en el catálogo.`;
    },
    [loadTrends]
  );

  async function runSearch(q: string) {
    const term = q.trim();
    if (!term) return;
    setSearching(true);
    setError("");
    setOverview(null);
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
    setNotice("");
    setIngestProgress("");
    const res = await fetch("/api/intel/ingest", { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      setIngesting(false);
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo actualizar Google Trends.");
      return;
    }
    const data = await res.json().catch(() => null) as { job?: { id?: string } } | null;
    const jobId = data?.job?.id;
    if (!jobId) {
      setIngesting(false);
      return;
    }
    // El trabajo corre fuera de la petición: aquí se sigue el avance real.
    const job = await pollIntelJob(jobId, (j) => {
      setIngestProgress(j.total > 0 ? `${j.completed}/${j.total} nichos` : "Iniciando…");
    });
    setIngesting(false);
    setIngestProgress("");
    if (!job) {
      setError("La ingesta está tardando más de lo esperado. Refresca en un momento.");
      return;
    }
    if (job.status === "error") {
      setError(job.error ?? "La ingesta de Google Trends falló.");
      return;
    }
    clearCompare();
    await loadTrends();
    // Una sola ingesta llena GT, tendencias y YouTube; se relee todo el bloque.
    setReloadKey((k) => k + 1);
    setNotice(ingestSummary(job.result));
  }

  /**
   * Releer UN nicho: gasta una consulta del proveedor en vez de las 15 de la
   * ingesta global. Es lo que quiere quien acaba de monitorear un término y
   * no quiere esperarse a la corrida completa.
   */
  async function refreshActiveNiche() {
    if (!activeTermId) return;
    setNicheRefreshing(true);
    setError("");
    const res = await fetch("/api/intel/gt/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ termId: activeTermId, geo: "MX" }),
    }).catch(() => null);
    if (!res?.ok) {
      setNicheRefreshing(false);
      const data = await res?.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo refrescar este nicho.");
      return;
    }
    const data = await res.json().catch(() => null) as { job?: { id?: string } } | null;
    const jobId = data?.job?.id;
    if (jobId) await pollIntelJob(jobId);
    setNicheRefreshing(false);
    await Promise.all([loadGt(activeTermId), loadTrends()]);
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
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <BarChart3 className="h-5 w-5 text-brand-text" /> Inteligencia
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-text-2">
          Busca un interés y el análisis se arma con datos reales de esa consulta: dificultad
          local (DENUE), interés y regiones de Google Trends, temas y consultas relacionadas,
          autocompletado y preguntas. Nada viene precargado ni se rellena con datos inventados:
          si una fuente no responde, el campo queda en «—» con su motivo.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="rounded-md border border-success-soft bg-success-tint p-3 text-sm text-success-text">
          {notice}
        </p>
      )}

      {/* Buscador de keyword: el resultado se despliega debajo, no en otra vista. */}
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

      {searching && (
        <p className="rounded-xl border bg-card p-4 text-sm text-text-2 shadow-sm">
          Consultando Google Trends, DENUE y autocompletado para «{query.trim()}»…
          La primera búsqueda puede tardar unos segundos.
        </p>
      )}

      {overview && (
        <section aria-label="Análisis de palabra clave">
          <KeywordView data={overview} onMonitored={() => void loadTrends()} />
        </section>
      )}

      {!overview && !searching && (
        <section
          aria-label="Empieza con una búsqueda"
          className="rounded-xl border bg-card p-6 text-center shadow-sm"
        >
          <Search className="mx-auto h-8 w-8 text-text-3" />
          <p className="mt-3 text-sm font-semibold">Escribe el interés que quieres analizar</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-text-2">
            No mostramos nichos predeterminados. Al pulsar «Analizar» se consultan las fuentes
            externas para esa keyword y se llenan la dificultad, la oferta local, la gráfica de
            interés, las subregiones, los temas y consultas relacionadas y las preguntas.
          </p>
          <p className="mt-2 text-xs text-text-3">
            Ejemplos para empezar: «cámaras de seguridad», «pc gamer», «starlink».
          </p>
        </section>
      )}

      {/* Explorador opcional: no se consulta ni se dibuja hasta abrirlo. */}
      <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Explorador de nichos monitoreados">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold">Explorar más</h2>
            <p className="mt-1 max-w-xl text-xs text-text-3">
              Tendencias actuales del país, nichos que ya monitoreas, comparativas, YouTube,
              audiencia y competencia local. Estas consultas solo se ejecutan si abres esta
              sección.
            </p>
          </div>
          <Button variant="outline" onClick={() => setExplore((v) => !v)}>
            {explore ? "Ocultar explorador" : "Abrir explorador"}
          </Button>
        </div>

        {explore && (
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap items-center justify-end gap-3">
              {trends?.lastIngestAt && (
                <span className="flex items-center gap-1 text-xs text-text-3">
                  <Clock className="h-3 w-3" />
                  Datos al {new Date(trends.lastIngestAt).toLocaleString("es-MX")}
                </span>
              )}
              <Button variant="outline" onClick={() => void handleIngest()} disabled={ingesting}>
                <RefreshCw className={`mr-2 h-4 w-4 ${ingesting ? "animate-spin" : ""}`} />
                {ingesting ? (ingestProgress || "Actualizando…") : "Actualizar datos"}
              </Button>
            </div>

            {/* Qué se busca ahora mismo en el país (Google Trends sin keyword propia). */}
            <TrendingPanel reloadKey={reloadKey} onMonitored={() => void loadTrends()} />

      {/* Ranking accionable: qué nichos conviene atacar */}
      {trends && trends.trends.length > 0 && (
        <GtRanking ranking={buildRanking(trends.trends)} />
      )}

      {/* Gráfica comparativa multi-nicho (todas las líneas normalizadas) */}
      {trends && trends.trends.length > 0 && (
        <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Comparativa multi-nicho">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Interés comparado · últimos 30 días</h2>
            <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-text-2">
              Google Trends
            </span>
          </div>
          <p className="mt-1 text-xs text-text-3">
            Cada nicho normalizado a su propio máximo (0–100). Fuente: Google Trends (MX).
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

      {/* Selector de nicho para los paneles GT */}
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={nicheRefreshing}
            onClick={() => void refreshActiveNiche()}
            title="Relee solo este nicho: una consulta del proveedor, no las 15"
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${nicheRefreshing ? "animate-spin" : ""}`} />
            {nicheRefreshing ? "Leyendo…" : "Refrescar este nicho"}
          </Button>
        </div>
      )}

      {/* Subregiones GT */}
      {gtReport && gtReport.regionsSource !== "none" && (
        <GtRegionPanel
          regions={gtReport.regions}
          regionsSource={gtReport.regionsSource}
          termName={gtReport.termName}
        />
      )}

      {/* Temas y consultas GT: las dos columnas una junto a la otra */}
      {gtReport && (
        <GtRelatedPanel
          topics={gtReport.topics}
          queries={gtReport.queries}
          termName={gtReport.termName}
          onMonitor={monitorKeyword}
        />
      )}

      {/* Cards de tendencia (selección para comparar) */}
      {trends && trends.trends.length > 0 && (
        <section aria-label="Detalle por nicho" className="space-y-3">
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
          {compareItems && (
            <CompareView items={compareItems} onRemove={toggleSelect} onClear={clearCompare} />
          )}
        </section>
      )}

      {/* Estado vacío: sin datos GT */}
      {loadingTrends ? (
        <p className="rounded-xl border bg-card p-5 text-sm text-text-2 shadow-sm">Consultando Google Trends…</p>
      ) : trends && trends.trends.length === 0 && (
        <div className="rounded-xl border bg-card p-5 text-sm text-text-2 shadow-sm">
          <p className="font-medium">Aún no hay nichos con datos.</p>
          <p className="mt-1 text-text-3">
            Configura SerpApi o Apify en Configuración → Inteligencia y pulsa «Actualizar datos»
            para ingerir el interés de búsqueda de los nichos. Las tendencias actuales y el
            contenido de YouTube funcionan aunque no tengas llaves.
          </p>
        </div>
      )}

      {/* Contenido que ya funciona en el feed (YouTube de los nichos monitoreados) */}
      <ContentPanel reloadKey={reloadKey} />

      {/* Contexto demográfico externo (ENDUTIH, no es dato del CRM) */}
      <AudiencePanel />

      {/* Competencia local DENUE (fuente externa INEGI) */}
      <GeoPanel terms={geoTerms} />
          </div>
        )}
      </section>
      </div>
    </div>
  );
}
