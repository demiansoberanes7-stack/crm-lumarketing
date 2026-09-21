"use client";

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

const COLORS = [
  "#B8963E", "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316",
];

const DARK_COLORS = [
  "#d4a84a", "#60a5fa", "#34d399", "#fbbf24", "#f87171",
  "#a78bfa", "#22d3ee", "#f472b6", "#a3e635", "#fb923c",
];

function useColors() {
  return typeof window !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark"
    ? DARK_COLORS
    : COLORS;
}

interface ChartProps {
  data: Record<string, unknown>[];
  height?: number;
}

/** Bar chart vertical */
export function BarChartCard({ data, xKey, yKey, yKeys, height = 250 }: ChartProps & { xKey: string; yKey: string; yKeys?: string[] }) {
  const colors = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        {yKeys && <Legend />}
        {(yKeys ?? [yKey]).map((key, i) => <Bar key={key} dataKey={key} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Bar chart horizontal (para top N) */
export function HorizontalBarChart({ data, yKey, xKey, height = 250 }: ChartProps & { xKey: string; yKey: string }) {
  const colors = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis type="number" tick={{ fontSize: 12 }} />
        <YAxis dataKey={yKey} type="category" tick={{ fontSize: 11 }} width={120} />
        <Tooltip />
        <Bar dataKey={xKey} fill={colors[0]} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Line chart */
export function LineChartCard({ data, xKey, yKeys, height = 250 }: ChartProps & { xKey: string; yKeys: string[] }) {
  const colors = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        {yKeys.map((key, i) => (
          <Line key={key} type="monotone" dataKey={key} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 3 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Pie / Donut chart */
export function PieChartCard({ data, nameKey, valueKey, height = 250, inner = false }: ChartProps & { nameKey: string; valueKey: string; inner?: boolean }) {
  const colors = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={inner ? 60 : 0}
          outerRadius={80}
          paddingAngle={2}
          dataKey={valueKey}
          nameKey={nameKey}
          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Area chart */
export function AreaChartCard({ data, xKey, yKeys, height = 250 }: ChartProps & { xKey: string; yKeys: string[] }) {
  const colors = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        {yKeys.map((key, i) => (
          <Area key={key} type="monotone" dataKey={key} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.15} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Gauge chart (semicircle) */
export function GaugeChart({ value, max = 100, label, height = 200 }: { value: number; max?: number; label?: string; height?: number }) {
  const pct = Math.max(0, Math.min((value / max) * 100, 100));
  const data = [{ value: pct, fill: pct > 70 ? "#10b981" : pct > 40 ? "#f59e0b" : "#ef4444" }];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadialBarChart cx="50%" cy="100%" innerRadius="60%" outerRadius="100%" startAngle={180} endAngle={0} data={data}>
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar background dataKey="value" cornerRadius={4} />
        <text x="50%" y="85%" textAnchor="middle" className="fill-foreground text-2xl font-bold">
          {`${value.toFixed(0)}%`}
        </text>
        {label && (
          <text x="50%" y="95%" textAnchor="middle" className="fill-muted-foreground text-xs">
            {label}
          </text>
        )}
      </RadialBarChart>
    </ResponsiveContainer>
  );
}

/** Stacked bar chart (para aging) */
export function StackedBarChart({ data, xKey, yKeys, height = 250 }: ChartProps & { xKey: string; yKeys: string[] }) {
  const colors = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        {yKeys.map((key, i) => (
          <Bar key={key} dataKey={key} stackId="a" fill={colors[i % colors.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Funnel chart (simplified as horizontal bars) */
export function FunnelChart({ data, height = 200 }: { data: { stage: string; value: number }[]; height?: number }) {
  const colors = useColors();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2" style={{ height }}>
      {data.map((d, i) => (
        <div key={d.stage} className="flex items-center gap-3">
          <span className="w-24 text-xs text-right text-muted-foreground">{d.stage}</span>
          <div className="flex-1 rounded-md overflow-hidden bg-secondary h-7">
            <div
              className="h-full rounded-md transition-all flex items-center px-2"
              style={{ width: `${(d.value / max) * 100}%`, backgroundColor: colors[i % colors.length] }}
            >
              <span className="text-xs font-medium text-white">{d.value}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
