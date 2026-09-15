"use client";

import { Wallet } from "lucide-react";
import { KpiCard, formatCurrency } from "../kpi-card";
import { PieChartCard, AreaChartCard, GaugeChart, HorizontalBarChart } from "../charts";

interface Props {
  data: {
    total: number; expenseVsIncome: number;
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
        <KpiCard title="% sobre Ingresos" value={`${data.expenseVsIncome.toFixed(1)}%`} />
        <KpiCard title="Categorías" value={data.byCategory.length} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Gasto vs Ingresos</p>
          <GaugeChart value={Math.min(data.expenseVsIncome, 100)} label="% gasto" />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Por categoría</p>
          <PieChartCard data={data.byCategory} nameKey="name" valueKey="amount" inner />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Gastos por mes</p>
          <AreaChartCard data={data.byMonth} xKey="month" yKeys={["amount"]} height={200} />
        </div>
      </div>
      {data.bySupplier.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Top proveedores</p>
          <HorizontalBarChart data={data.bySupplier} yKey="name" xKey="amount" height={150} />
        </div>
      )}
    </section>
  );
}
