"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Calculator, Database, Info, Store } from "lucide-react";

const numberCompact = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });
const numberFull = new Intl.NumberFormat("es-MX");
const p2 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

export type Descriptive = {
  n: number;
  mean: number;
  median: number;
  std: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
};

export type SearchReport = {
  query: string;
  term: { id: string; name: string } | null;
  classification: "A" | "B" | "C" | "D";
  headline: string;
  warnings: string[];
  series: Descriptive | null;
  seriesPoints: Array<{ day: string; value: number }>;
  videos: (Descriptive & {
    sample: Array<{ videoId: string; title: string; views: number; likes: number }>;
  }) | null;
  inferencia: { z: number | null; p: number | null; window: string };
  competencia: {
    establecimientos: number;
    censored: boolean;
    fuente: string;
    nota: string;
  } | null;
  method: { fuente: string; geo: string; ventana: string };
  generatedAt: string;
};

const CLASS_STYLE: Record<SearchReport["classification"], { label: string; chip: string }> = {
  A: { label: "A · crece", chip: "bg-success/10 text-success" },
  B: { label: "B · estable", chip: "bg-brand-tint text-brand-text" },
  C: { label: "C · contrae", chip: "bg-warning-tint text-warning-text" },
  D: { label: "D · sin datos", chip: "bg-subtle text-text-3" },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-text-3">{label}</dt>
      <dd className="truncate text-sm font-semibold">{value}</dd>
    </div>
  );
}

export function ReportView({ report }: { report: SearchReport }) {
  const cls = CLASS_STYLE[report.classification];
  return (
    <article className="space-y-4" aria-label="Informe de búsqueda">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls.chip}`}>{cls.label}</span>
          <h2 className="min-w-0 truncate font-semibold" title={report.term?.name ?? report.query}>
            {report.term?.name ?? report.query}
          </h2>
        </div>
        <p className="mt-2 text-sm text-text-2">{report.headline}</p>
        {report.term === null && (
          <p className="mt-2 text-xs text-text-3">
            La búsqueda no coincide con un nicho del catálogo: solo se registra en el historial.
          </p>
        )}
        {report.warnings.length > 0 && (
          <ul className="mt-3 space-y-1">
            {report.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 rounded-md bg-warning-tint px-3 py-2 text-xs text-warning-text">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}
      </section>

      {report.series && report.seriesPoints.length > 0 && (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="flex items-center gap-2 font-semibold">
            <Database className="h-4 w-4 text-brand-text" /> Descriptiva · serie diaria
          </h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Stat label="Días" value={String(report.series.n)} />
            <Stat label="Mediana" value={numberCompact.format(report.series.median)} />
            <Stat label="Rango intercuartílico" value={`${numberCompact.format(report.series.p25)}–${numberCompact.format(report.series.p75)}`} />
            <Stat label="Mín–Máx" value={`${numberCompact.format(report.series.min)}–${numberCompact.format(report.series.max)}`} />
          </dl>
          <div className="mt-4 h-48" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={report.seriesPoints} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={(v: number) => numberCompact.format(v)} />
                <Tooltip formatter={(v) => [numberFull.format(Number(v)), "Vistas"]} labelFormatter={(l) => `Día ${l}`} />
                <Line type="monotone" dataKey="value" stroke="currentColor" className="text-brand-text" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-text-3">
            Vistas acumuladas de los videos coincidentes por día (proxy de interés; no es búsqueda orgánica).
          </p>
        </section>
      )}

      {report.videos && (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="font-semibold">Muestra de videos coincidentes</h3>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Stat label="Videos" value={String(report.videos.n)} />
            <Stat label="Mediana de vistas" value={numberCompact.format(report.videos.median)} />
            <Stat label="Percentil 90" value={numberCompact.format(report.videos.p75)} />
          </dl>
          <ul className="mt-3 space-y-2">
            {report.videos.sample.slice(0, 5).map((v) => (
              <li key={v.videoId} className="flex min-w-0 items-baseline justify-between gap-3 rounded-md border p-2.5">
                <span className="min-w-0 truncate text-sm" title={v.title}>{v.title || "(sin título)"}</span>
                <span className="shrink-0 text-xs font-medium text-text-2">{numberCompact.format(v.views)} vistas</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h3 className="flex items-center gap-2 font-semibold">
          <Calculator className="h-4 w-4 text-brand-text" /> Inferencia
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Stat label="z-score" value={report.inferencia.z === null ? "s/ base" : p2.format(report.inferencia.z)} />
          <Stat label="p (unilateral)" value={report.inferencia.p === null ? "s/ base" : report.inferencia.p < 0.001 ? "< 0.001" : p2.format(report.inferencia.p)} />
          <Stat label="Ventana" value={report.inferencia.window} />
        </dl>
        <p className="mt-2 text-[11px] leading-snug text-text-3">
          El z-score compara el promedio de la ventana reciente contra el histórico previo
          (media y desviación muestral). p es la probabilidad de observar ese promedio o mayor
          si no hubiera cambio real. No es causalidad ni predicción.
        </p>
      </section>

      {report.competencia && (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h3 className="flex items-center gap-2 font-semibold">
            <Store className="h-4 w-4 text-brand-text" /> Competencia · {report.competencia.fuente}
          </h3>
          <p className="mt-2 text-sm">
            <span className="text-2xl font-semibold">
              {report.competencia.censored ? "≥" : ""}
              {numberFull.format(report.competencia.establecimientos)}
            </span>{" "}
            <span className="text-text-2">establecimientos coincidentes en el directorio nacional</span>
          </p>
          <p className="mt-1 text-[11px] text-text-3">{report.competencia.nota}</p>
        </section>
      )}

      <p className="text-[11px] leading-snug text-text-3">
        Método: {report.method.fuente} · geo {report.method.geo} · ventana {report.method.ventana} ·
        generado {new Date(report.generatedAt).toLocaleString("es-MX")}.
      </p>
    </article>
  );
}
