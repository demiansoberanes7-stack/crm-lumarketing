"use client";

import { TrendingUp } from "lucide-react";
import { BarChartCard, LineChartCard } from "../charts";

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
      <div className="grid gap-4 lg:grid-cols-2">
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
