"use client";

import { DollarSign } from "lucide-react";
import { KpiCard, formatCurrency } from "../kpi-card";
import { PieChartCard, AreaChartCard } from "../charts";

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        <KpiCard title="Ingresos Brutos" value={formatCurrency(data.grossIncome)} icon={<DollarSign />} />
        <KpiCard title="Ticket Promedio" value={formatCurrency(data.avgTicket)} />
        <KpiCard title="Total Pagos" value={data.count} />
        <KpiCard title="Con Comprobante" value={`${data.withReceiptRate.toFixed(0)}%`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Por método de pago</p>
          <PieChartCard data={data.byMethod.map((d) => ({ ...d, amount: d.amount / 100 }))} nameKey="name" valueKey="amount" inner />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Ingresos por mes</p>
          <AreaChartCard data={data.byMonth.map((d) => ({ ...d, MXN: d.amount / 100 }))} xKey="month" yKeys={["MXN"]} height={200} />
        </div>
      </div>
    </section>
  );
}
