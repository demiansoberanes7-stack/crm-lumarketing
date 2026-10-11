"use client";

import { Clock, AlertTriangle } from "lucide-react";
import { KpiCard, formatCurrency, formatPercent } from "../kpi-card";
import { StackedBarChart, HorizontalBarChart } from "../charts";
import { ChartCard } from "../chart-card";

interface Props {
  data: {
    totalPending: number; overdueCount: number; overdueAmount: number;
    overdueRate: number | null;
    aging: { bucket: string; amount: number }[];
    topDebtors: { id: string; concept: string; amount: number }[];
  };
}

export function ReceivablesSection({ data }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <Clock className="h-4 w-4" /> Cuentas por Cobrar
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 mb-4">
        <KpiCard title="Tasa de Mora" value={formatPercent(data.overdueRate)} subtitle="Saldo vencido / saldo pendiente" />
        <KpiCard title="Monto Vencido" value={formatCurrency(data.overdueAmount)} icon={<AlertTriangle />} />
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <ChartCard title="Aging de deuda (días vencida)">
          <StackedBarChart
            data={[{
              bucket: "Vencido",
              ...Object.fromEntries(data.aging.map((a) => [a.bucket, a.amount / 100])),
            }]}
            xKey="bucket" yKeys={["1-30", "31-60", "61-90", "91+"]} height={200}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--chart-1)]" /> 1-30 días</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--chart-2)]" /> 31-60</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--chart-3)]" /> 61-90</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[var(--chart-4)]" /> 91+</span>
          </div>
        </ChartCard>
        <ChartCard title="Cuentas con mayor saldo (MXN)">
          {data.topDebtors.length > 0 ? (
            <HorizontalBarChart
              data={data.topDebtors.map((d) => ({ name: d.concept || d.id.slice(0, 12), amount: d.amount / 100 }))}
              yKey="name" xKey="amount" height={200}
            />
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">Sin deudas pendientes</p>
          )}
        </ChartCard>
      </div>
    </section>
  );
}
