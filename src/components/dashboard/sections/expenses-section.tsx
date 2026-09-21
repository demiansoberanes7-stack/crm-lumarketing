"use client";

import { Wallet } from "lucide-react";
import { KpiCard, formatCurrency, formatPercent } from "../kpi-card";
import { PieChartCard, AreaChartCard, GaugeChart, HorizontalBarChart } from "../charts";

interface Props {
  data: {
    total: number; expenseVsIncome: number | null;
    byCategory: { name: string; amount: number }[];
    bySupplier: { name: string; amount: number }[];
    byMonth: { month: string; amount: number }[];
  };
}

export function ExpensesSection({ data }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <Wallet className="h-4 w-4" /> Gastos
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
        <KpiCard title="Gasto Total" value={formatCurrency(data.total)} icon={<Wallet />} />
        <KpiCard title="% sobre Ingresos" value={formatPercent(data.expenseVsIncome)} />
        <KpiCard title="Categorías" value={data.byCategory.length} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Gasto vs Ingresos</p>
          {data.expenseVsIncome === null ? <p>N/D: sin ingresos en el período</p> : <GaugeChart value={data.expenseVsIncome} label="% gasto" />}
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Por categoría</p>
          <PieChartCard data={data.byCategory.map((d) => ({ ...d, amount: d.amount / 100 }))} nameKey="name" valueKey="amount" inner />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Gastos por mes</p>
          <AreaChartCard data={data.byMonth.map((d) => ({ ...d, MXN: d.amount / 100 }))} xKey="month" yKeys={["MXN"]} height={200} />
        </div>
      </div>
      {data.bySupplier.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Top proveedores</p>
          <HorizontalBarChart data={data.bySupplier.map((d) => ({ ...d, amount: d.amount / 100 }))} yKey="name" xKey="amount" height={150} />
        </div>
      )}
    </section>
  );
}
