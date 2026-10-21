"use client";

import { useCallback, useEffect, useState } from "react";
import { Clapperboard, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * «Contenido que funciona»: cómo se ve lo que ya está arriba del feed popular
 * de YouTube en los nichos monitoreados.
 *
 * Es la fuente YouTube del módulo (la key de `intel_credentials`), que hasta
 * ahora se ingería y se analizaba en `/api/intel/content` pero nunca se mostró.
 * La muestra es SESGADA a popularidad — son videos que ya están en el feed de
 * México, no el universo del nicho—, así que sirve para calibrar formato y
 * duración, no para proyectar resultados.
 */

type ContentVideo = {
  videoId: string;
  title: string;
  views: number;
  likes: number;
  engagementPct: number | null;
  durationSeconds: number | null;
  bucket: string;
  channelTitle: string | null;
};

type ContentInsights = {
  windowDays: number;
  dayStart: string;
  dayEnd: string;
  totalRows: number;
  uniqueVideos: number;
  /** Consulta que acotó la muestra (null = muestra completa). */
  query: string | null;
  matchedVideos: number;
  top: ContentVideo[];
  durationStats: Array<{ bucket: string; label: string; count: number; medianViews: number; avgEngagementPct: number | null }>;
  patternStats: Array<{ pattern: string; label: string; count: number; medianViews: number }>;
  termStats: Array<{ termId: string; name: string; videos: number; medianViews: number; avgEngagementPct: number | null }>;
  generatedAt: string;
};

const WINDOWS = [7, 30, 90] as const;

const views = (n: number) => new Intl.NumberFormat("es-MX").format(n);

export function ContentPanel({
  reloadKey,
  query = null,
}: {
  reloadKey: number;
  /**
   * Palabra buscada arriba: el panel se acota a los videos que hablan de ella
   * en vez de ocultarse. Con `q` vacío se muestra la muestra completa.
   */
  query?: string | null;
}) {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<ContentInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const scope = query?.trim() ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ days: String(days) });
    if (scope) params.set("q", scope);
    const res = await fetch(`/api/intel/content?${params.toString()}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      setData((await res.json().catch(() => null)) as ContentInsights | null);
    } else {
      setError("No se pudo leer la muestra de YouTube.");
    }
    setLoading(false);
  }, [days, scope]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const empty = !!data && data.uniqueVideos === 0;
  /**
   * La muestra SÍ llegó, pero ningún video habla de la consulta. Decirlo así,
   * no como «no hay contenido»: el feed popular de MX simplemente no trata ese
   * tema, y esa es información útil.
   */
  const outOfScope = !!data && !empty && scope.length > 0 && data.matchedVideos === 0;

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Contenido que funciona">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 font-semibold">
            <Clapperboard className="h-4 w-4 text-brand-text" /> Contenido que funciona
          </h2>
          <p className="mt-1 text-xs text-text-3">
            {scope ? (
              <>
                {data ? `${views(data.matchedVideos)} de ${views(data.uniqueVideos)} videos` : "Videos"}
                {" "}populares de {data?.windowDays ?? days} días que hablan de «{scope}» (YouTube,
                mostPopular MX).
              </>
            ) : (
              <>
                Muestra de {data?.uniqueVideos ?? 0} videos populares de {data?.windowDays ?? days} días
                que coinciden con los nichos monitoreados (YouTube, mostPopular MX).
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={days === w}
              onClick={() => setDays(w)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                days === w ? "bg-brand-tint text-brand-text" : "text-text-2 hover:text-foreground"
              }`}
            >
              {w}d
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-danger-soft bg-danger-tint p-2 text-xs text-danger-text">
          {error}
        </p>
      )}

      {empty ? (
        <p className="mt-3 rounded-md bg-subtle p-3 text-xs text-text-2">
          Todavía no hay videos capturados. Configura la API key de YouTube en Conexiones →
          Inteligencia y pulsa «Actualizar datos»: esa corrida lee el feed popular de MX y lo
          contrae contra los nichos monitoreados. Sin key no hay de dónde leer — este panel no se
          rellena con datos de otra fuente.
        </p>
      ) : outOfScope ? (
        <p className="mt-3 rounded-md bg-subtle p-3 text-xs text-text-2">
          Ninguno de los {views(data.uniqueVideos)} videos del feed popular de{" "}
          {data.windowDays} días menciona «{scope}». La muestra está sesgada a lo que ya es
          popular en México, así que esto dice más de la muestra que del interés: para ver
          contenido del tema, monitorealo (arriba, «+ Monitorear») y vuelve a leer, o abre el
          panel sin la palabra buscada.
        </p>
      ) : data ? (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-3">Duración</h3>
            <ul className="mt-2 space-y-1 text-xs">
              {data.durationStats.map((s) => (
                <li key={s.bucket} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{s.label}</span>
                  <span className="shrink-0 tabular-nums text-text-2">
                    {s.count} · {views(s.medianViews)} vistas med.
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-3">
              Patrón de título
            </h3>
            <ul className="mt-2 space-y-1 text-xs">
              {data.patternStats.map((s) => (
                <li key={s.pattern} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{s.label}</span>
                  <span className="shrink-0 tabular-nums text-text-2">
                    {s.count} · {views(s.medianViews)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-3">
              Por nicho
            </h3>
            <ul className="mt-2 space-y-1 text-xs">
              {data.termStats.slice(0, 6).map((s) => (
                <li key={s.termId} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{s.name}</span>
                  <span className="shrink-0 tabular-nums text-text-2">
                    {s.videos} video{s.videos === 1 ? "" : "s"}
                    {s.avgEngagementPct !== null ? ` · ${s.avgEngagementPct.toFixed(1)}% eng.` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {data.top.length > 0 && (
            <div className="md:col-span-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-3">
                Muestra más vista
              </h3>
              <ul className="mt-2 divide-y divide-border/50 text-xs">
                {data.top.slice(0, 8).map((v) => (
                  <li key={v.videoId} className="flex items-center gap-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate" title={v.title}>
                      {v.title}
                    </span>
                    <span className="shrink-0 text-text-3">{v.channelTitle ?? "—"}</span>
                    <span className="shrink-0 tabular-nums">{views(v.views)} vistas</span>
                    <span className="shrink-0 tabular-nums text-text-2">
                      {v.engagementPct === null ? "—" : `${v.engagementPct.toFixed(1)}% eng.`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p role="status" className="mt-3 text-xs text-text-3">
          Calculando la muestra…
        </p>
      )}
    </section>
  );
}
