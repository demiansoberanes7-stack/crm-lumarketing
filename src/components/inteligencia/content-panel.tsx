"use client";

import { useEffect, useState } from "react";
import { Clapperboard } from "lucide-react";

/**
 * Contenidos que funcionan (Grupo D) — agregados de la muestra de videos
 * capturados por la ingesta. Cada bloque declara unidad y la advertencia de
 * sesgo (muestra popular, no el universo del nicho).
 */

type DurationStat = {
  bucket: string;
  label: string;
  count: number;
  medianViews: number;
  avgEngagementPct: number | null;
};

type PatternStat = {
  pattern: string;
  label: string;
  count: number;
  medianViews: number;
};

type TermStat = {
  termId: string;
  name: string;
  videos: number;
  medianViews: number;
  avgEngagementPct: number | null;
};

type ContentVideoView = {
  videoId: string;
  title: string;
  views: number;
  likes: number;
  engagementPct: number | null;
  durationSeconds: number | null;
  bucket: string;
  channelTitle: string | null;
};

type ContentInsightsView = {
  windowDays: number;
  dayStart: string;
  dayEnd: string;
  uniqueVideos: number;
  top: ContentVideoView[];
  durationStats: DurationStat[];
  patternStats: PatternStat[];
  termStats: TermStat[];
};

const numberCompact = new Intl.NumberFormat("es-MX", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const p1 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

function fmtDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ContentPanel() {
  const [data, setData] = useState<ContentInsightsView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/intel/content?days=30", { cache: "no-store" }).catch(() => null);
      if (cancelled) return;
      if (res?.ok) {
        const json = (await res.json().catch(() => null)) as ContentInsightsView | null;
        setData(json);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const maxMedian = data
    ? Math.max(...data.patternStats.map((s) => s.medianViews), ...data.durationStats.map((s) => s.medianViews), 1)
    : 1;

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Contenidos que funcionan">
      <h2 className="flex items-center gap-2 font-semibold">
        <Clapperboard className="h-4 w-4 text-brand-text" /> Contenidos que funcionan
        <span className="text-sm font-normal text-text-2">(YouTube MX · muestra popular)</span>
      </h2>

      {loading && <p className="mt-3 text-sm text-text-2">Analizando videos capturados…</p>}

      {!loading && data && data.uniqueVideos === 0 && (
        <p className="mt-3 rounded-md bg-subtle p-3 text-sm text-text-2">
          Aún no hay videos capturados en los últimos 30 días. Ejecuta «Actualizar datos»
          en la parte superior del módulo.
        </p>
      )}

      {!loading && data && data.uniqueVideos > 0 && (
        <>
          <p className="mt-2 text-xs text-text-3">
            {data.uniqueVideos} videos únicos · {data.dayStart} → {data.dayEnd} ·
            engagement = likes/vistas × 100
          </p>

          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold text-text-2">Mediana de vistas por formato</h3>
              <ul className="mt-2 space-y-1.5">
                {data.durationStats.map((s) => (
                  <li key={s.bucket} className="flex items-center gap-2">
                    <span className="w-[110px] shrink-0 text-[11px] text-text-3">{s.label}</span>
                    <span className="relative h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-subtle">
                      <span
                        className="absolute inset-y-0 left-0 rounded-sm bg-brand-text/70"
                        style={{ width: `${(s.medianViews / maxMedian) * 100}%` }}
                      />
                    </span>
                    <span className="w-[92px] shrink-0 text-right text-[11px] font-medium tabular-nums">
                      {numberCompact.format(s.medianViews)} vistas
                    </span>
                    <span className="w-[70px] shrink-0 text-right text-[11px] text-text-3">
                      n={s.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-text-2">Mediana de vistas por estilo de título</h3>
              <ul className="mt-2 space-y-1.5">
                {data.patternStats.map((s) => (
                  <li key={s.pattern} className="flex items-center gap-2">
                    <span className="w-[110px] shrink-0 truncate text-[11px] text-text-3" title={s.label}>
                      {s.label}
                    </span>
                    <span className="relative h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-subtle">
                      <span
                        className="absolute inset-y-0 left-0 rounded-sm bg-brand-text/70"
                        style={{ width: `${(s.medianViews / maxMedian) * 100}%` }}
                      />
                    </span>
                    <span className="w-[92px] shrink-0 text-right text-[11px] font-medium tabular-nums">
                      {numberCompact.format(s.medianViews)} vistas
                    </span>
                    <span className="w-[70px] shrink-0 text-right text-[11px] text-text-3">
                      n={s.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <h3 className="text-xs font-semibold text-text-2">Top 10 videos de la muestra</h3>
            <table className="mt-2 w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] text-text-3">
                  <th className="py-1.5 pr-3 font-medium">Título</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Vistas</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Eng %</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Duración</th>
                  <th className="py-1.5 font-medium">Canal</th>
                </tr>
              </thead>
              <tbody>
                {data.top.map((v) => (
                  <tr key={v.videoId} className="border-b last:border-0">
                    <td className="max-w-[260px] truncate py-1.5 pr-3" title={v.title}>{v.title}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{numberCompact.format(v.views)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {v.engagementPct === null ? "—" : `${p1.format(v.engagementPct)}%`}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{fmtDuration(v.durationSeconds)}</td>
                    <td className="max-w-[140px] truncate py-1.5 text-[12px] text-text-2">{v.channelTitle ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.termStats.length > 0 && (
            <div className="mt-5">
              <h3 className="text-xs font-semibold text-text-2">Por nicho (videos coincidentes)</h3>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {data.termStats.map((s) => (
                  <li key={s.termId} className="flex items-center justify-between gap-2 rounded-md bg-subtle px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 truncate font-medium">{s.name}</span>
                    <span className="shrink-0 tabular-nums text-text-3">
                      n={s.videos} · mediana {numberCompact.format(s.medianViews)}
                      {s.avgEngagementPct !== null && ` · eng ${p1.format(s.avgEngagementPct)}%`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-4 border-t pt-3 text-[11px] leading-snug text-text-3">
            <span className="font-semibold">Sesgo de muestra: </span>
            son videos que YA estaban en el feed popular de YouTube México y que coinciden
            con tus nichos — sirven para ver cómo se ve el contenido que funciona, no para
            proyectar resultados. Unidad: vistas (mediana) y likes/vistas × 100 (engagement;
            dislikes y comentarios no están en la capa gratuita). Fuente: YouTube Data API
            (mostPopular, MX) capturado por la ingesta diaria.
          </p>
        </>
      )}
    </section>
  );
}
