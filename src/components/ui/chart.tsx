"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { cn } from "@/lib/utils";

/**
 * Primitivas de gráfica al estilo del starter (shadcn chart adaptado a
 * Tailwind 3 + recharts): config por serie, contenedor con alto fijo y el
 * área punteada —grid discontinuo y relleno de puntos— que caracteriza el
 * look del dashboard de referencia.
 */

export type ChartConfig = Record<string, { label: string; color: string }>;

export function ChartContainer({
  config,
  className,
  children,
}: {
  config: ChartConfig;
  className?: string;
  children: React.ReactNode;
}) {
  // Expone cada color como --color-<key> para que recharts lo lea por var().
  const style = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color])
  ) as React.CSSProperties;
  return (
    <div className={cn("h-44 w-full", className)} style={style}>
      {children}
    </div>
  );
}

/** Tooltip con estilo neutro del chrome (sin depender de shadcn/radix). */
export function ChartSimpleTooltip({
  active,
  payload,
  label,
  format,
}: TooltipProps<number, string> & { format?: (value: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-md">
      {label != null && <p className="mb-0.5 font-medium text-foreground">{String(label)}</p>}
      {payload.map((entry) => (
        <p key={entry.dataKey} className="tabular-nums text-text-2">
          <span
            className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
            style={{ background: entry.color }}
          />
          {format ? format(Number(entry.value)) : String(entry.value)}
        </p>
      ))}
    </div>
  );
}

/**
 * `useId()` de React 19 puede devolver caracteres no-ASCII que rompen
 * `url(#…)`: se depuran igual que en dashboard/charts.tsx.
 */
function useCleanId() {
  return useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Área punteada del starter: grid discontinuo horizontal, relleno con
 * patrón de puntos y trazo fino. `series` pinta un área por llave.
 */
export function DottedAreaChart({
  data,
  series,
  height = 176,
  xKey,
  yFormatter,
  className,
}: {
  data: Record<string, unknown>[];
  series: { key: string; color: string; label?: string }[];
  height?: number;
  xKey: string;
  yFormatter?: (value: number) => string;
  className?: string;
}) {
  const id = useCleanId();
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {series.map((s) => (
              <pattern
                key={s.key}
                id={`${id}-${s.key}`}
                x="0"
                y="0"
                width="7"
                height="7"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="5" cy="5" r="1.5" fill={s.color} opacity="0.5" />
              </pattern>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 3" />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fontSize: 10, fill: "var(--chart-text)" }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            tick={{ fontSize: 10, fill: "var(--chart-text)" }}
            tickFormatter={yFormatter}
          />
          <Tooltip
            cursor={false}
            content={<ChartSimpleTooltip format={yFormatter} />}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              dataKey={s.key}
              type="natural"
              fill={`url(#${id}-${s.key})`}
              fillOpacity={0.4}
              stroke={s.color}
              strokeWidth={1.2}
              stackId="a"
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
