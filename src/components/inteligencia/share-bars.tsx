"use client";

/**
 * Share de interés por nicho — panel oscuro estilo "Nielsen aggregated view".
 *
 * Barras horizontales ordenadas de mayor a menor con % del share del último
 * feed. El fondo navy es intencional y permanece así en tema claro/oscuro
 * (es el panel insignia del módulo). Unidad: % del total de vistas del
 * último feed entre los nichos monitoreados (no es share de mercado total).
 */

type ShareRow = { name: string; pct: number; views: number };

const numberCompact = new Intl.NumberFormat("es-MX", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Escala de color por rango, como el original de Nielsen: arriba vivo, abajo pálido. */
function barColor(rank: number, total: number): string {
  if (total <= 1) return "#5c7cfa";
  const t = rank / Math.max(total - 1, 1);
  if (t < 0.25) return "#5c7cfa";
  if (t < 0.5) return "#748ffc";
  if (t < 0.75) return "#97b1ff";
  return "#bac8ff";
}

export function ShareBars({ rows }: { rows: ShareRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="rounded-xl bg-[#0a1226] p-5 shadow-sm sm:p-6">
        <h2 className="text-sm font-semibold tracking-tight text-white/90">
          Interés por nicho · share del último feed
        </h2>
        <p className="mt-3 text-sm text-white/60">
          Sin datos todavía. Ejecuta «Actualizar datos» para capturar el feed del día.
        </p>
      </section>
    );
  }
  const max = Math.max(...rows.map((r) => r.pct), 0.001);
  return (
    <section className="rounded-xl bg-[#0a1226] p-5 shadow-sm sm:p-6" aria-label="Share de interés por nicho">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-white/90">
          Interés por nicho · share del último feed
        </h2>
        <span className="text-[11px] text-white/50">
          % de vistas del feed · MX · YouTube mostPopular
        </span>
      </div>
      <ul className="mt-4 space-y-2">
        {rows.map((row, i) => (
          <li key={row.name} className="flex items-center gap-3">
            <span className="w-[38%] shrink-0 truncate text-right text-[12px] font-medium text-white/85 sm:w-[220px] sm:text-[13px]" title={row.name}>
              {row.name}
            </span>
            <span className="relative h-[22px] min-w-0 flex-1 overflow-hidden rounded-[4px] bg-white/[0.04]">
              <span
                className="absolute inset-y-0 left-0 rounded-[4px] transition-[width] duration-500"
                style={{
                  width: `${Math.max((row.pct / max) * 100, 1.5)}%`,
                  background: `linear-gradient(90deg, ${barColor(i, rows.length)} 0%, ${barColor(i, rows.length)} 78%, ${barColor(i, rows.length)}dd 100%)`,
                }}
              />
            </span>
            <span className="w-[52px] shrink-0 text-right text-[12px] font-semibold tabular-nums text-white/90 sm:w-[64px] sm:text-[13px]">
              {row.pct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-snug text-white/45">
        Unidad: % del total de vistas del último feed entre los nichos monitoreados
        ({rows.reduce((a, r) => a + r.views, 0) === 0 ? "0" : numberCompact.format(rows.reduce((a, r) => a + r.views, 0))} vistas).
        No es participación de mercado ni volumen de búsquedas. Fuente: YouTube Data API (mostPopular, MX).
      </p>
    </section>
  );
}
