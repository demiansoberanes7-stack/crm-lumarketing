"use client";

import { Clock, AlertTriangle } from "lucide-react";
import { KpiCard, formatCurrency } from "../kpi-card";
import { StackedBarChart, HorizontalBarChart } from "../charts";

interface Props {
  data: {
    totalPending: number; overdueCount: number; overdueAmount: number;
    overdueRate: number;
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        <KpiCard title="Total por Cobrar" value={formatCurrency(data.totalPending)} icon={<Clock />} />
        <KpiCard title="Vencidas" value={data.overdueCount} icon={<AlertTriangle />}
          trend={data.overdueCount > 0 ? "down" : "neutral"} trendValue={formatCurrency(data.overdueAmount)} />
        <KpiCard title="Tasa de Mora" value={`${data.overdueRate.toFixed(1)}%`} />
        <KpiCard title="Monto Vencido" value={formatCurrency(data.overdueAmount)} icon={<AlertTriangle />} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Aging de deuda (días vencida)</p>
          <StackedBarChart
            data={[{
              bucket: "Vencido",
              "0-30": data.aging.find((a) => a.bucket === "0-30")?.amount ?? 0,
              "31-60": data.aging.find((a) => a.bucket === "31-60")?.amount ?? 0,
              "61-90": data.aging.find((a) => a.bucket === "61-90")?.amount ?? 0,
              "90+": data.aging.find((a) => a.bucket === "90+")?.amount ?? 0,
            }]}
            xKey="bucket" yKeys={["0-30", "31-60", "61-90", "90+"]} height={200}
          />
          <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#B8963E]" /> 0-30 días</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#3b82f6]" /> 31-60</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#10b981]" /> 61-90</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#f59e0b]" /> 90+</span>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Top deudores</p>
          {data.topDebtors.length > 0 ? (
            <HorizontalBarChart
              data={data.topDebtors.map((d) => ({ name: d.concept || d.id.slice(0, 12), amount: d.amount }))}
              yKey="name" xKey="amount" height={200}
            />
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">Sin deudas pendientes</p>
          )}
        </div>
      </div>
    </section>
  );
}
