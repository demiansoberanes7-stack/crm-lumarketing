"use client";

import { TrendingUp } from "lucide-react";
import { KpiCard, formatCurrency, formatPercent } from "../kpi-card";
import { BarChartCard, LineChartCard, GaugeChart } from "../charts";

interface Props {
  data: {
    netIncome: number; margin: number | null;
    incomeVsExpenses: { month: string; income: number; expense: number }[];
    weeklyCashFlow: { week: string; income: number; expense: number; net: number }[];
  };
}

export function ProfitabilitySection({ data }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <TrendingUp className="h-4 w-4" /> Resultado de caja · ingresos cobrados menos gastos pagados
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
        <KpiCard title="Resultado de caja" value={formatCurrency(data.netIncome)} icon={<TrendingUp />}
          trend={data.netIncome === 0 ? "neutral" : data.netIncome > 0 ? "up" : "down"} />
        <KpiCard title="Margen de caja" value={formatPercent(data.margin)} />
        <KpiCard title="Flujo de Caja (neto)" value={formatCurrency(
          data.weeklyCashFlow.reduce((s, w) => s + w.net, 0)
        )} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Margen neto</p>
          {data.margin === null ? <p>N/D: sin ingresos en el período</p> : <GaugeChart value={data.margin} label="margen de caja" />}
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Ingresos vs Gastos mensual</p>
          <BarChartCard
            data={data.incomeVsExpenses.map((d) => ({ name: d.month.slice(5), Ingresos: d.income / 100, Gastos: d.expense / 100 }))}
            xKey="name" yKey="Ingresos" yKeys={["Ingresos", "Gastos"]} height={200}
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
