const numberCompact = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });

type Trend = {
  termId: string;
  name: string;
  z: number | null;
  lastValue: number;
  series: Array<{ day: string; value: number }>;
};

function Sparkline({ series }: { series: Array<{ day: string; value: number }> }) {
  if (series.length < 2) return null;
  const values = series.map((s) => s.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 100;
  const height = 28;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-full" aria-hidden="true" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-text" />
    </svg>
  );
}

function ZChip({ z }: { z: number | null }) {
  if (z === null) {
    return (
      <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-text-3">
        z: s/ dato
      </span>
    );
  }
  const rising = z >= 1.5;
  const flat = z >= 0 && z < 1.5;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        rising
          ? "bg-success-tint text-success-text"
          : flat
            ? "bg-brand-tint text-brand-text"
            : "bg-warning-tint text-warning-text"
      }`}
    >
      z {z >= 0 ? "+" : ""}{z.toFixed(2)}
    </span>
  );
}

export function TrendCard({
  trend,
  selected = false,
  onSelect,
}: {
  trend: Trend;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <article
      className={`flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors ${
        selected ? "border-brand-text ring-1 ring-brand-text" : ""
      }`}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <h3 className="min-w-0 truncate font-semibold" title={trend.name}>{trend.name}</h3>
        <ZChip z={trend.z} />
      </div>
      <Sparkline series={trend.series} />
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
        <div>
          <dt className="inline text-text-3">Índice GT hoy: </dt>
          <dd className="inline font-medium">{numberCompact.format(trend.lastValue)}</dd>
        </div>
      </dl>
      {onSelect && (
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className={`mt-auto min-h-9 rounded-md border px-2 text-xs font-medium transition-colors ${
            selected
              ? "border-brand-text bg-brand-tint text-brand-text"
              : "text-text-2 hover:bg-accent"
          }`}
        >
          {selected ? "✓ en comparativa" : "+ comparar"}
        </button>
      )}
    </article>
  );
}
