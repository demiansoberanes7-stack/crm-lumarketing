"use client";

import { Fragment, useId } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from "recharts";

const SERIES_COUNT = 6;

function useChartId() {
  return useId().replace(/:/g, "");
}

function gradientId(id: string, index: number, kind = "series") {
  return `${id}-${kind}-${index % SERIES_COUNT}`;
}

/** IDs locales por gráfica: evita colisiones cuando la misma visual aparece dos veces. */
function ChartDefs({ id }: { id: string }) {
  return (
    <defs>
      {Array.from({ length: SERIES_COUNT }, (_, index) => {
        const color = index + 1;
        return (
          <Fragment key={index}>
            <linearGradient id={gradientId(id, index)} x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor={`var(--chart-${color})`} stopOpacity="0.7" />
              <stop offset="100%" stopColor={`var(--chart-${color}-end)`} />
            </linearGradient>
            <linearGradient id={gradientId(id, index, "line")} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={`var(--chart-${color})`} />
              <stop offset="100%" stopColor={`var(--chart-${color}-end)`} />
            </linearGradient>
            <linearGradient id={gradientId(id, index, "area")} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={`var(--chart-${color}-end)`} stopOpacity="var(--chart-area-opacity)" />
              <stop offset="100%" stopColor={`var(--chart-${color})`} stopOpacity="0.015" />
            </linearGradient>
            <filter id={gradientId(id, index, "glow")} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </Fragment>
        );
      })}
      <linearGradient id={`${id}-gauge`} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="var(--chart-2)" />
        <stop offset="55%" stopColor="var(--chart-1)" />
        <stop offset="100%" stopColor="var(--chart-3-end)" />
      </linearGradient>
      <filter id={`${id}-gauge-glow`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: "var(--bg-panel)",
  border: "1px solid var(--border-strong)",
  borderRadius: "9px",
  color: "var(--text)",
  boxShadow: "var(--shadow-md)",
  fontSize: 12,
};

const GRID_PROPS = {
  stroke: "var(--chart-grid)",
  strokeDasharray: "3 5",
  vertical: false,
};

const X_TICK = { fill: "var(--chart-text)", fontSize: 10 };
const Y_TICK = { fill: "var(--chart-text)", fontSize: 10 };

interface ChartProps {
  data: Record<string, unknown>[];
  height?: number;
}

/** Vertical bars with gradient fills and a restrained neon halo. */
export function BarChartCard({ data, xKey, yKey, yKeys, height = 250 }: ChartProps & { xKey: string; yKey: string; yKeys?: string[] }) {
  const id = useChartId();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
        <ChartDefs id={id} />
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey={xKey} tick={X_TICK} minTickGap={20} tickLine={false} axisLine={false} />
        <YAxis tick={Y_TICK} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--text)", fontWeight: 600 }} />
        {yKeys && <Legend height={32} wrapperStyle={{ color: "var(--text-2)", fontSize: 10 }} />}
        {(yKeys ?? [yKey]).map((key, index) => (
          <Bar
            key={key}
            dataKey={key}
            fill={`url(#${gradientId(id, index)})`}
            filter={`url(#${gradientId(id, index, "glow")})`}
            radius={[5, 5, 0, 0]}
            maxBarSize={42}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars keep category labels compact on phones; full text stays in the tooltip. */
export function HorizontalBarChart({ data, yKey, xKey, height = 250 }: ChartProps & { xKey: string; yKey: string }) {
  const id = useChartId();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <ChartDefs id={id} />
        <CartesianGrid {...GRID_PROPS} />
        <XAxis type="number" tick={X_TICK} tickLine={false} axisLine={false} />
        <YAxis
          dataKey={yKey}
          type="category"
          tick={Y_TICK}
          tickLine={false}
          axisLine={false}
          width={96}
          tickFormatter={(value: string | number) => {
            const label = String(value);
            return label.length > 15 ? `${label.slice(0, 14)}…` : label;
          }}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--text)", fontWeight: 600 }} />
        <Bar dataKey={xKey} fill={`url(#${gradientId(id, 0)})`} filter={`url(#${gradientId(id, 0, "glow")})`} radius={[0, 5, 5, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Neon-gradient line chart. */
export function LineChartCard({ data, xKey, yKeys, height = 250 }: ChartProps & { xKey: string; yKeys: string[] }) {
  const id = useChartId();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
        <ChartDefs id={id} />
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey={xKey} tick={X_TICK} minTickGap={20} tickLine={false} axisLine={false} />
        <YAxis tick={Y_TICK} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--text)", fontWeight: 600 }} />
        <Legend height={32} wrapperStyle={{ color: "var(--text-2)", fontSize: 10 }} />
        {yKeys.map((key, index) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={`url(#${gradientId(id, index, "line")})`}
            strokeWidth={2.6}
            filter={`url(#${gradientId(id, index, "glow")})`}
            dot={{ r: 2.5, fill: `var(--chart-${(index % SERIES_COUNT) + 1}-end)`, stroke: "var(--bg-panel)", strokeWidth: 1.5 }}
            activeDot={{ r: 5, stroke: "var(--bg-panel)", strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Pie / donut with gradient sectors and a compact legend instead of clipped radial labels. */
export function PieChartCard({ data, nameKey, valueKey, height = 250, inner = false }: ChartProps & { nameKey: string; valueKey: string; inner?: boolean }) {
  const id = useChartId();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <ChartDefs id={id} />
        <Pie
          data={data}
          cx="50%"
          cy="46%"
          innerRadius={inner ? "48%" : 0}
          outerRadius="62%"
          paddingAngle={3}
          dataKey={valueKey}
          nameKey={nameKey}
          stroke="var(--bg-panel)"
          strokeWidth={2}
        >
          {data.map((_, index) => (
            <Cell key={index} fill={`url(#${gradientId(id, index)})`} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--text)", fontWeight: 600 }} />
        <Legend verticalAlign="bottom" height={48} wrapperStyle={{ color: "var(--text-2)", fontSize: 10 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Area with a translucent vertical gradient and a glowing gradient stroke. */
export function AreaChartCard({ data, xKey, yKeys, height = 250 }: ChartProps & { xKey: string; yKeys: string[] }) {
  const id = useChartId();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
        <ChartDefs id={id} />
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey={xKey} tick={X_TICK} minTickGap={20} tickLine={false} axisLine={false} />
        <YAxis tick={Y_TICK} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--text)", fontWeight: 600 }} />
        <Legend height={32} wrapperStyle={{ color: "var(--text-2)", fontSize: 10 }} />
        {yKeys.map((key, index) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stroke={`url(#${gradientId(id, index, "line")})`}
            strokeWidth={2.4}
            fill={`url(#${gradientId(id, index, "area")})`}
            filter={`url(#${gradientId(id, index, "glow")})`}
            activeDot={{ r: 4, stroke: "var(--bg-panel)", strokeWidth: 2 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Neon semicircle gauge, clamped to the configured range. */
export function GaugeChart({ value, max = 100, label, height = 200 }: { value: number; max?: number; label?: string; height?: number }) {
  const id = useChartId();
  const pct = max > 0 ? Math.max(0, Math.min((value / max) * 100, 100)) : 0;
  const data = [{ value: pct }];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadialBarChart cx="50%" cy="100%" innerRadius="62%" outerRadius="94%" startAngle={180} endAngle={0} data={data}>
        <ChartDefs id={id} />
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar
          background={{ fill: "var(--chart-track)" }}
          dataKey="value"
          fill={`url(#${id}-gauge)`}
          filter={`url(#${id}-gauge-glow)`}
          cornerRadius={10}
        />
        <text x="50%" y="84%" textAnchor="middle" fill="var(--text)" fontSize="23" fontWeight="700">
          {`${pct.toFixed(0)}%`}
        </text>
        {label && (
          <text x="50%" y="96%" textAnchor="middle" fill="var(--chart-text)" fontSize="10">
            {label}
          </text>
        )}
      </RadialBarChart>
    </ResponsiveContainer>
  );
}

/** Stacked bar chart (aging); the adjacent HTML legend provides localized labels. */
export function StackedBarChart({ data, xKey, yKeys, height = 250 }: ChartProps & { xKey: string; yKeys: string[] }) {
  const id = useChartId();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
        <ChartDefs id={id} />
        <CartesianGrid {...GRID_PROPS} />
        <XAxis dataKey={xKey} tick={X_TICK} minTickGap={20} tickLine={false} axisLine={false} />
        <YAxis tick={Y_TICK} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "var(--text)", fontWeight: 600 }} />
        {yKeys.map((key, index) => (
          <Bar key={key} dataKey={key} stackId="a" fill={`url(#${gradientId(id, index)})`} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Funnel chart (horizontal neon bars). */
export function FunnelChart({ data, height = 200 }: { data: { stage: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2" style={{ minHeight: height }}>
      {data.map((d, index) => {
        const color = (index % SERIES_COUNT) + 1;
        return (
          <div key={d.stage} className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span title={d.stage} className="w-20 shrink-0 truncate text-right text-xs text-muted-foreground sm:w-24">{d.stage}</span>
            <div className="h-7 min-w-0 flex-1 overflow-hidden rounded-md bg-[var(--chart-track)]">
              <div
                className="h-full rounded-md transition-all"
                style={{
                  width: `${(d.value / max) * 100}%`,
                  background: `linear-gradient(90deg, var(--chart-${color}), var(--chart-${color}-end))`,
                  boxShadow: `0 0 14px var(--chart-${color})`,
                }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">{d.value}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Fila del Gantt: una barra horizontal con rango de fechas y barra de progreso. */
export interface GanttItem {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  progress?: number;
  status?: string;
  priority?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  activo: "var(--chart-1)",
  en_proceso: "var(--chart-2)",
  completado: "var(--chart-3)",
  cerrado: "var(--chart-3)",
  terminado: "var(--chart-3)",
  pendiente: "var(--chart-4)",
  no_empezado: "var(--chart-5)",
  borrador: "var(--chart-5)",
  en_revision: "var(--chart-2)",
  cancelado: "var(--chart-track)",
};

function statusColor(status?: string) {
  return STATUS_COLORS[status ?? ""] ?? "var(--chart-1)";
}

/**
 * Diagrama de Gantt en SVG puro: eje X con fechas, barras por fila, y una
 * barra de progreso interior cuando el ítem tiene `progress` (0-100).
 */
export function GanttChart({ items, height = 280 }: { items: GanttItem[]; height?: number }) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Sin datos para el cronograma.</p>;
  }

  // Calcular rango de fechas: si todos tienen endDate, usar min/max; si no,
  // usar startDate min → hoy + 14 días de holgura.
  const today = new Date();
  const startDates = items.map((i) => new Date(i.startDate).getTime());
  const endDates = items
    .map((i) => (i.endDate ? new Date(i.endDate).getTime() : today.getTime() + 14 * 86_400_000));
  const minTime = Math.min(...startDates);
  const maxTime = Math.max(...endDates, today.getTime());
  const range = Math.max(1, maxTime - minTime);

  // Etiquetas del eje: 5 marcas equidistantes
  const ticks = Array.from({ length: 6 }, (_, i) => new Date(minTime + (range * i) / 5));
  const tickLabel = (d: Date) => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });

  const rowH = 28;
  const padLeft = 120;
  const padRight = 16;

  return (
    <div className="overflow-x-auto" style={{ maxHeight: height }}>
      <div className="min-w-[500px]">
        {/* Eje X */}
        <div className="relative mb-1 h-5" style={{ paddingLeft: padLeft, paddingRight: padRight }}>
          {ticks.map((d, i) => (
            <span
              key={i}
              className="absolute text-[10px] text-muted-foreground"
              style={{ left: `calc(${padLeft}px + (100% - ${padLeft + padRight}px) * ${i / 5})` }}
            >
              {tickLabel(d)}
            </span>
          ))}
        </div>
        {/* Filas */}
        <div className="space-y-1">
          {items.map((item, idx) => {
            const s = new Date(item.startDate).getTime();
            const e = item.endDate ? new Date(item.endDate).getTime() : today.getTime() + 7 * 86_400_000;
            const leftPct = ((s - minTime) / range) * 100;
            const widthPct = Math.max(2, ((e - s) / range) * 100);
            const color = statusColor(item.status);
            return (
              <div key={item.id} className="flex items-center gap-2" style={{ height: rowH }}>
                <span className="w-28 shrink-0 truncate text-xs text-muted-foreground" title={item.name}>
                  {item.name}
                </span>
                <div className="relative h-5 min-w-0 flex-1 rounded bg-[var(--chart-track)]">
                  <div
                    className="absolute inset-y-0.5 rounded"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      background: `linear-gradient(90deg, ${color}, ${color})`,
                      opacity: 0.85,
                    }}
                  >
                    {/* Barra de progreso interior */}
                    {item.progress != null && item.progress > 0 && (
                      <div
                        className="absolute inset-y-0 left-0 rounded"
                        style={{ width: `${Math.min(100, item.progress)}%`, background: color, opacity: 0.4 }}
                      />
                    )}
                  </div>
                  {/* Línea de hoy */}
                  {idx === 0 && (
                    <div
                      className="absolute inset-y-0 w-px bg-muted-foreground/40"
                      style={{ left: `${((today.getTime() - minTime) / range) * 100}%` }}
                    />
                  )}
                </div>
                <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                  {item.progress != null ? `${item.progress}%` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
