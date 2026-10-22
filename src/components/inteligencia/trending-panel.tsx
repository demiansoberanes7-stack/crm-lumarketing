"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Flame, Plus, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadCsv, formatVolume, relativeStart } from "@/components/inteligencia/intel-export";
import {
  relateTrendRows,
  type FallbackCatalogTerm,
  type FallbackPrimary,
} from "@/lib/intel-fallback";
import { pollIntelJob } from "@/lib/intel-jobs-client";

/**
 * Tabla «Tendencias actuales» (lo que se busca ahora mismo en el país).
 *
 * Lee de la BD y solo va a buscar datos cuando el usuario pulsa «Actualizar»:
 * así abrir Inteligencia no gasta cuota ni depende de que el proveedor
 * responda. El desglose se muestra desplegable porque en Google Trends esa
 * columna es un «y 43 más» que hay que abrir para ver nada.
 */

type TrendingRow = {
  id: string;
  title: string;
  volume: number | null;
  increasePct: number | null;
  startedAt: string | null;
  active: boolean;
  category: string | null;
  trendType: string | null;
  breakdown: Array<{ name: string; type?: string }>;
  source: string;
};

type TrendingView = {
  rows: TrendingRow[];
  total: number;
  hours: number;
  geo: string;
  categories: string[];
  types: string[];
  lastIngestAt: string | null;
  source: string | null;
};

type Props = {
  /** Cambia cuando la ingesta global del encabezado termina, para releer. */
  reloadKey: number;
  onMonitored: () => void;
  /**
   * Palabra buscada arriba. Cuando viene, la tabla arranca filtrada por ella:
   * la fuente del país sigue visible, pero leída en relación a la consulta.
   */
  relatedTo?: string | null;
  /**
   * Catálogo de nichos con sus keywords, en orden de parecido a la búsqueda.
   * Con él la tabla etiqueta cada tendencia y puede caer al mismo giro cuando
   * la consulta no aparece en el feed.
   */
  catalog?: readonly FallbackCatalogTerm[];
  /** Nicho que corresponde a la búsqueda: ancla del «mismo giro». */
  primaryNiche?: FallbackPrimary | null;
};

const WINDOWS = [
  { hours: 4, label: "Últimas 4 horas" },
  { hours: 24, label: "Últimas 24 horas" },
  { hours: 48, label: "Últimas 48 horas" },
  { hours: 168, label: "Últimos 7 días" },
] as const;

const SORTS = [
  { value: "relevance", label: "Relevancia" },
  { value: "volume", label: "Volumen de búsqueda" },
  { value: "increase", label: "Alza" },
  { value: "recent", label: "Más recientes" },
] as const;

const SOURCE_LABEL: Record<string, string> = {
  serpapi: "Google Trends · SerpApi",
  rss: "Google Trends · feed público",
  mixta: "Google Trends · SerpApi + feed público",
};

const selectCls = "rounded border bg-card p-1.5 text-xs";

export function TrendingPanel({
  reloadKey,
  onMonitored,
  relatedTo = null,
  catalog = [],
  primaryNiche = null,
}: Props) {
  const [view, setView] = useState<TrendingView | null>(null);
  const [hours, setHours] = useState<number>(24);
  const [category, setCategory] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState<string>("relevance");
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ hours: String(hours), sort });
    if (category) params.set("category", category);
    if (type) params.set("type", type);
    const res = await fetch(`/api/intel/trending?${params.toString()}`, { cache: "no-store" }).catch(
      () => null
    );
    if (res?.ok) {
      const data = (await res.json().catch(() => null)) as TrendingView | null;
      setView(data);
    } else {
      setError("No se pudieron leer las tendencias ingeridas.");
    }
    setLoading(false);
  }, [hours, category, type, sort]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // La búsqueda de arriba manda: la tabla arranca acotada a esa palabra, y quien
  // quiera ver el país completo solo vacía el campo.
  useEffect(() => {
    setQuery(relatedTo?.trim() ?? "");
    setPage(0);
  }, [relatedTo]);

  // La búsqueda de texto es client-side: las filas ya están filtradas por
  // ventana y categoría en el servidor, y el título no debe gastar peticiones.
  // Si la consulta no aparece en el feed, `relateTrendRows` cae al mismo giro,
  // luego a cualquier nicho del catálogo y al final al país: la tabla nunca
  // queda vacía habiendo filas ingeridas, y cada nivel se declara en pantalla.
  const fallback = useMemo(
    () => relateTrendRows(view?.rows ?? [], query, catalog, primaryNiche),
    [view, query, catalog, primaryNiche]
  );
  const rows = fallback.rows;

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const slice = rows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const firstPicked = rows.find((entry) => entry.row.id === picked[0])?.row ?? null;

  const fallbackSummary = (() => {
    const q = query.trim();
    if (!q) return "";
    if (fallback.level === "consulta") {
      return ` · ${fallback.matched} de ${view?.rows.length ?? 0} mencionan alguna palabra de «${q}»`;
    }
    if (fallback.level === "mismo-giro") {
      return ` · sin coincidencias para «${q}»; ${rows.length} del mismo giro por alcance`;
    }
    if (fallback.level === "catalogo") {
      return ` · sin coincidencias para «${q}»; ${rows.length} de tus nichos por alcance`;
    }
    return ` · sin coincidencias para «${q}»; ${rows.length} de mayor alcance del país`;
  })();

  const fallbackNote =
    fallback.level === "mismo-giro"
      ? `Ninguna tendencia de la ventana menciona «${query.trim()}». Para no dejar el panel vacío, abajo van las de mayor alcance del mismo giro (${fallback.sameGiro.join(", ")}), cada una con el nicho y la palabra que la relacionan.`
      : fallback.level === "catalogo"
        ? `Ninguna tendencia de la ventana menciona «${query.trim()}» ni comparte giro con «${primaryNiche?.name ?? "tu búsqueda"}». Abajo van las de mayor alcance de tus nichos monitoreados, etiquetadas por el nicho que las explica.`
        : fallback.level === "pais"
          ? `Ni «${query.trim()}» ni tus nichos aparecen en el feed de esta ventana. Abajo van las tendencias de mayor alcance del país: no tienen relación con tu catálogo y así se etiquetan.`
          : null;

  async function refresh() {
    setRefreshing(true);
    setError("");
    setNotice("");
    const res = await fetch(`/api/intel/trending?hours=${hours}`, { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      setRefreshing(false);
      const data = (await res?.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(data?.error?.message ?? "No se pudo actualizar las tendencias.");
      return;
    }
    const data = (await res.json().catch(() => null)) as { job?: { id?: string } } | null;
    const jobId = data?.job?.id;
    if (!jobId) {
      setRefreshing(false);
      return;
    }
    const job = await pollIntelJob(jobId);
    setRefreshing(false);
    if (!job) {
      setError("La ingesta de tendencias está tardando más de lo esperado.");
      return;
    }
    if (job.status === "error") {
      setError(job.error ?? "Ninguna fuente de tendencias respondió.");
      return;
    }
    setNotice("Tendencias actualizadas.");
    await load();
    onMonitored();
  }

  async function monitor(title: string) {
    setNotice("");
    const res = await fetch("/api/intel/monitor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword: title }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      setError(data?.error?.message ?? "No se pudo crear el nicho.");
      return;
    }
    const data = (await res.json().catch(() => null)) as { created?: boolean; name?: string } | null;
    setNotice(
      data?.created
        ? `«${data.name ?? title}» ya se monitorea como nicho.`
        : `«${data?.name ?? title}» ya estaba en el catálogo.`
    );
    onMonitored();
  }

  function togglePick(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const windowLabel = WINDOWS.find((w) => w.hours === hours)?.label ?? "Últimas 24 horas";

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Tendencias actuales">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 font-semibold">
            <Flame className="h-4 w-4 text-brand-text" /> Tendencias actuales
          </h2>
          <p className="mt-1 text-xs text-text-3">
            {SOURCE_LABEL[view?.source ?? ""] ?? "Google Trends"} · {view?.geo ?? "MX"} ·{" "}
            {windowLabel}
            {view?.lastIngestAt
              ? ` · leído ${new Date(view.lastIngestAt).toLocaleString("es-MX")}`
              : ""}
            {fallbackSummary}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {picked.length > 0 && (
            <span className="text-xs text-text-2">{picked.length} seleccionadas</span>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `tendencias-${hours}h.csv`,
                ["tendencia", "volumen", "inicio", "alza_pct", "categoria", "tipo", "desglose", "fuente", "relacion"],
                rows.map(({ row, niche, level }) => [
                  row.title,
                  row.volume ?? "",
                  row.startedAt ? new Date(row.startedAt).toISOString() : "",
                  row.increasePct ?? "",
                  row.category ?? "",
                  row.trendType ?? "",
                  row.breakdown.map((b) => b.name).join(" | "),
                  row.source,
                  niche
                    ? `${niche.name} · vía «${niche.via}»`
                    : level === "pais"
                      ? "sin relación con el catálogo"
                      : "",
                ])
              )
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" /> Exportar
          </Button>
          <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Actualizando…" : "Actualizar"}
          </Button>
        </div>
      </header>

      {/* Barra de filtros: ventana, categoría, tipo, orden y búsqueda. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="Ventana de tiempo"
          className={selectCls}
          value={hours}
          onChange={(e) => {
            setHours(Number(e.target.value));
            setPage(0);
          }}
        >
          {WINDOWS.map((w) => (
            <option key={w.hours} value={w.hours}>
              {w.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Categoría"
          className={selectCls}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Todas las categorías</option>
          {(view?.categories ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          aria-label="Tipo de tendencia"
          className={selectCls}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Todos los tipos</option>
          {(view?.types ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          aria-label="Ordenar por"
          className={selectCls}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              Ordenar por: {s.label}
            </option>
          ))}
        </select>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Filtrar tendencias…"
            aria-label="Filtrar tendencias"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-danger-soft bg-danger-tint p-2 text-xs text-danger-text">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 flex items-center gap-1 text-xs text-brand-text">
          {notice}
          <button type="button" aria-label="Cerrar aviso" onClick={() => setNotice("")}>
            <X className="h-3 w-3" />
          </button>
        </p>
      )}

      {fallbackNote && (
        <p role="status" className="mt-3 rounded-md border bg-subtle p-2 text-xs text-text-2">
          {fallbackNote}
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-text-3">
              <th className="w-8 pb-2 pr-2">
                <span className="sr-only">Seleccionar</span>
              </th>
              <th className="pb-2 pr-3 font-medium">Tendencias</th>
              <th className="pb-2 pr-3 font-medium">Volumen de búsqueda</th>
              <th className="pb-2 pr-3 font-medium">Inicio</th>
              <th className="pb-2 pr-3 font-medium">Desglose de tendencias</th>
              <th className="pb-2 font-medium">Últimas 24 horas</th>
            </tr>
          </thead>
          <tbody>
            {slice.map(({ row: r, niche }) => {
              const expanded = open === r.id;
              const hidden = r.breakdown.length - 3;
              return (
                <tr key={r.id} className="border-b border-border/50 align-top last:border-0">
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={picked.includes(r.id)}
                      aria-label={`Seleccionar ${r.title}`}
                      onChange={() => togglePick(r.id)}
                      className="h-3.5 w-3.5 accent-brand"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="min-w-0 font-medium">{r.title}</span>
                      {r.active && (
                        <span className="rounded bg-success-tint px-1.5 py-0.5 text-[10px] font-medium text-success-text">
                          Activa
                        </span>
                      )}
                      {r.trendType && (
                        <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[10px] text-text-2">
                          {r.trendType}
                        </span>
                      )}
                      {niche && (
                        <span
                          className="rounded-full border px-1.5 py-0.5 text-[10px] text-text-2"
                          title={`El título menciona «${niche.via}», palabra del nicho «${niche.name}».`}
                        >
                          {niche.name} · «{niche.via}»
                        </span>
                      )}
                    </div>
                    {r.category && <p className="mt-0.5 text-[11px] text-text-3">{r.category}</p>}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{formatVolume(r.volume)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-text-2">
                    {relativeStart(r.startedAt)}
                  </td>
                  <td className="py-2 pr-3">
                    {r.breakdown.length === 0 ? (
                      <span className="text-text-3">—</span>
                    ) : (
                      <div className="max-w-xs">
                        <ul className="space-y-0.5 text-text-2">
                          {(expanded ? r.breakdown : r.breakdown.slice(0, 3)).map((b, i) => (
                            <li key={`${b.name}-${i}`} className="truncate" title={b.name}>
                              {b.name}
                            </li>
                          ))}
                        </ul>
                        {hidden > 0 && (
                          <button
                            type="button"
                            onClick={() => setOpen(expanded ? null : r.id)}
                            className="mt-0.5 text-[11px] font-medium text-brand-text hover:underline"
                          >
                            {expanded ? "Ver menos" : `y ${hidden} más`}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2">
                    {r.increasePct === null ? (
                      <span className="text-text-3">—</span>
                    ) : (
                      <span className="font-medium tabular-nums text-success-text">
                        +{r.increasePct}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-text-3">
                  {query.trim()
                    ? `No hay tendencias ingeridas en esta ventana, así que no hay nada que relacionar con «${query.trim()}». «Actualizar» lee el feed completo; el buscador de arriba analiza esa palabra clave en vivo.`
                    : "Sin tendencias en la ventana pedida. Pulsa «Actualizar» para leer el feed de Google Trends."}
                </td>
              </tr>
            )}
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-text-3">
                  Leyendo tendencias…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-[11px] text-text-3">
        {picked.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!firstPicked}
            onClick={() => firstPicked && void monitor(firstPicked.title)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Monitorear la primera seleccionada
          </Button>
        ) : (
          <span>Cada fila puede convertirse en un nicho monitoreado con «+» o seleccionándola.</span>
        )}
        <span className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            Filas por página
            <select
              aria-label="Filas por página"
              className={selectCls}
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="tabular-nums">
            {rows.length === 0 ? 0 : safePage * pageSize + 1}–
            {Math.min(rows.length, (safePage + 1) * pageSize)} de {rows.length}
          </span>
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded border px-1.5 disabled:opacity-40"
          >
            ‹
          </button>
          <button
            type="button"
            disabled={safePage >= pages - 1}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            className="rounded border px-1.5 disabled:opacity-40"
          >
            ›
          </button>
        </span>
      </footer>
    </section>
  );
}
