"use client";

import { DollarSign } from "lucide-react";
import { KpiCard, formatCurrency } from "../kpi-card";
import { PieChartCard, AreaChartCard } from "../charts";
import { ChartCard } from "../chart-card";

interface Props {
  data: {
    grossIncome: number; count: number; avgTicket: number;
    withReceipt: number; withReceiptRate: number;
    byMethod: { name: string; amount: number }[];
    byMonth: { month: string; amount: number }[];
  };
}

export function PaymentsSection({ data }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <DollarSign className="h-4 w-4" /> Pagos Recibidos
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
        <KpiCard title="Cobro promedio" value={formatCurrency(data.avgTicket)} />
        <KpiCard title="Total Pagos" value={data.count} />
        <KpiCard title="Con Comprobante" value={`${data.withReceiptRate.toFixed(0)}%`} />
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <ChartCard title="Por método de pago">
          <PieChartCard data={data.byMethod.map((d) => ({ ...d, amount: d.amount / 100 }))} nameKey="name" valueKey="amount" inner />
        </ChartCard>
        <ChartCard title="Ingresos por mes">
          <AreaChartCard data={data.byMonth.map((d) => ({ ...d, MXN: d.amount / 100 }))} xKey="month" yKeys={["MXN"]} height={200} />
        </ChartCard>
      </div>
    </section>
  );
}
