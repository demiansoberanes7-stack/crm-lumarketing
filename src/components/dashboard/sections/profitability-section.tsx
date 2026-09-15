"use client";

import { TrendingUp } from "lucide-react";
import { KpiCard, formatCurrency } from "../kpi-card";
import { BarChartCard, LineChartCard, GaugeChart } from "../charts";

interface Props {
  data: {
    netIncome: number; margin: number;
    incomeVsExpenses: { month: string; income: number; expense: number }[];
    weeklyCashFlow: { week: string; income: number; expense: number; net: number }[];
  };
}

export function ProfitabilitySection({ data }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <TrendingUp className="h-4 w-4" /> Rentabilidad
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
        <KpiCard title="Utilidad Neta" value={formatCurrency(data.netIncome)} icon={<TrendingUp />}
          trend={data.netIncome > 0 ? "up" : "down"} />
        <KpiCard title="Margen Neto" value={`${data.margin.toFixed(1)}%`} />
        <KpiCard title="Flujo de Caja (neto)" value={formatCurrency(
          data.weeklyCashFlow.reduce((s, w) => s + w.net, 0)
        )} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Margen neto</p>
          <GaugeChart value={Math.max(0, Math.min(100, data.margin))} label="margen" />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Ingresos vs Gastos mensual</p>
          <BarChartCard
            data={data.incomeVsExpenses.map((d) => ({ name: d.month.slice(5), Ingresos: d.income / 100, Gastos: d.expense / 100 }))}
            xKey="name" yKey="Ingresos" height={200}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Flujo de caja semanal</p>
          <LineChartCard
            data={data.weeklyCashFlow.map((d) => ({ name: d.week.slice(5), Neto: d.net / 100 }))}
            xKey="name" yKeys={["Neto"]} height={200}
          />
        </div>
      </div>
    </section>
  );
}
