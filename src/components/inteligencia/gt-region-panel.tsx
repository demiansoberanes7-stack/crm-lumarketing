"use client";

import { useMemo, useState } from "react";
import { MapPinned } from "lucide-react";
import { MEXICO_STATES } from "@/lib/mexico-states";

/**
 * Panel de subregiones estilo Google Trends: mapa de rejilla de México
 * coloreado por índice 0–100 (100 = estado con más interés) + lista del
 * top-5 paginada. Unidad: índice Google Trends (0–100 relativo al máximo
 * del país en la ventana consultada). Fuente declarada en el pie.
 */

type RegionItem = {
  state: string;
  index: number;
  source: "google_trends" | "denue";
};

type Props = {
  regions: RegionItem[];
  regionsSource: "google_trends" | "denue" | "none";
  termName: string;
  /** Relación del nicho mostrado con la búsqueda activa (null sin búsqueda). */
  note?: string | null;
};

const PAGE_SIZE = 5;

export function GtRegionPanel({ regions, regionsSource, termName, note = null }: Props) {
  const [page, setPage] = useState(0);

  const byState = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of regions) map.set(r.state, r.index);
    return map;
  }, [regions]);

  const sorted = useMemo(
    () => [...regions].sort((a, b) => b.index - a.index),
    [regions]
  );
  const max = sorted.length > 0 ? Math.max(...sorted.map((r) => r.index), 1) : 1;
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageItems = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (regionsSource === "none" || sorted.length === 0) {
    return (
      <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Interés por subregión">
        <h2 className="flex items-center gap-2 font-semibold">
          <MapPinned className="h-4 w-4 text-brand-text" /> Interés por subregión
        </h2>
        {note && <p className="mt-1 text-xs text-text-3">{note}</p>}
        <p className="mt-3 rounded-md bg-subtle p-3 text-sm text-text-2">
          Aún no hay datos geográficos para «{termName}». Ejecuta una ingesta de Google
          Trends para poblar el mapa.
        </p>
      </section>
    );
  }

  const fuenteLabel =
    regionsSource === "google_trends"
      ? "Google Trends (endpoint no oficial)"
      : "DENUE · INEGI (normalizado 0–100, fallback)";

  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm" aria-label="Interés por subregión">
      <h2 className="flex items-center gap-2 font-semibold">
        <MapPinned className="h-4 w-4 text-brand-text" /> Interés por subregión
        <span className="text-sm font-normal text-text-2">({fuenteLabel})</span>
      </h2>
      {note && <p className="mt-1 text-xs text-text-3">{note}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_220px]">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: "repeat(9, minmax(0, 1fr))" }}
          role="img"
          aria-label={`Mapa de interés por subregión para ${termName}`}
        >
          {MEXICO_STATES.map((s) => {
            const index = byState.get(s.code);
            if (index === undefined) {
              return (
                <div
                  key={s.code}
                  title={`${s.name}: sin dato`}
                  className="flex min-h-[44px] flex-col items-center justify-center rounded-[4px] border border-border/40 bg-subtle/50 px-0.5"
                  style={{ gridColumn: s.col + 1, gridRow: s.row + 1 }}
                >
                  <span className="text-[9px] font-semibold leading-tight text-text-3 sm:text-[10px]">{s.short}</span>
                  <span className="text-[9px] leading-tight text-text-3 sm:text-[10px]">—</span>
                </div>
              );
            }
            const alpha = index === 0 ? 0.08 : 0.1 + 0.9 * (index / max);
            const dark = alpha > 0.55;
            return (
              <div
                key={s.code}
                title={`${s.name}: índice ${index} (0–100, Google Trends)`}
                className="flex min-h-[44px] flex-col items-center justify-center rounded-[4px] border border-border/40 px-0.5"
                style={{
                  gridColumn: s.col + 1,
                  gridRow: s.row + 1,
                  background: `rgba(99, 102, 241, ${alpha.toFixed(3)})`,
                  color: dark ? "#fff" : "var(--color-text-2, #344054)",
                }}
              >
                <span className="text-[9px] font-semibold leading-tight sm:text-[10px]">{s.short}</span>
                <span className="text-[9px] tabular-nums leading-tight sm:text-[10px]">{index}</span>
              </div>
            );
          })}
        </div>

        <div>
          <h3 className="text-xs font-semibold text-text-2">Top subregiones</h3>
          <p className="mt-0.5 text-[11px] text-text-3">
            Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} de {sorted.length}
          </p>
          <ol className="mt-2 space-y-1.5">
            {pageItems.map((r) => {
              const name = MEXICO_STATES.find((s) => s.code === r.state)?.name ?? r.state;
              return (
                <li key={r.state} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">{name}</span>
                  <span className="shrink-0 font-medium tabular-nums">{r.index}</span>
                </li>
              );
            })}
          </ol>
          {totalPages > 1 && (
            <div className="mt-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded border px-1.5 py-0.5 text-[11px] disabled:opacity-40"
              >
                ←
              </button>
              <span className="text-[11px] text-text-3">
                {page + 1}/{totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded border px-1.5 py-0.5 text-[11px] disabled:opacity-40"
              >
                →
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 border-t pt-3 text-[11px] leading-snug text-text-3">
        Unidad: índice 0–100 (100 = subregión con más interés en la ventana). Las posiciones
        en la rejilla son aproximadas. Fuente: {fuenteLabel}.
      </p>
    </section>
  );
}
