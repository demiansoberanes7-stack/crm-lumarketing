"use client";

import { FileText } from "lucide-react";
import { KpiCard, formatCurrency, formatPercent } from "../kpi-card";
import { FunnelChart, LineChartCard, PieChartCard } from "../charts";
import { ChartCard } from "../chart-card";

interface Props {
  data: {
    total: number; sent: number; approved: number; approvalRate: number | null; excludedCurrency: number;
    avgTicket: number; pipelineValue: number; avgDiscount: number;
    byMonth: { month: string; sent: number; approved: number }[];
    byChannel: { name: string; count: number }[];
  };
}

export function QuotesSection({ data }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <FileText className="h-4 w-4" /> Cotizaciones
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 mb-4">
        <KpiCard title="Ticket Promedio" value={formatCurrency(data.avgTicket)} icon={<FileText />} />
        <KpiCard title="Tasa de Aprobación" value={formatPercent(data.approvalRate)} subtitle="Aceptadas / enviadas, incl. rechazadas y expiradas" />
        <KpiCard title="Pipeline del período" value={formatCurrency(data.pipelineValue)} subtitle="Borradores y enviadas vigentes" />
        <KpiCard title="Descuento Promedio" value={formatCurrency(data.avgDiscount)} />
        <KpiCard title="Enviadas" value={data.sent} />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Cohorte por fecha de creación, sin archivadas. Enviadas incluye aceptadas, rechazadas y expiradas. {data.excludedCurrency > 0 && `${data.excludedCurrency} cotizaciones en otras monedas excluidas de los KPIs MXN.`}</p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <ChartCard title="Embudo de conversión">
          <FunnelChart data={[
            { stage: "Creadas", value: data.total },
            { stage: "Enviadas", value: data.sent },
            { stage: "Aprobadas", value: data.approved },
          ]} />
        </ChartCard>
        <ChartCard title="Cotizaciones por mes">
          <LineChartCard data={data.byMonth} xKey="month" yKeys={["sent", "approved"]} height={200} />
        </ChartCard>
        <ChartCard title="Por canal de envío">
          <PieChartCard data={data.byChannel} nameKey="name" valueKey="count" inner />
        </ChartCard>
      </div>
    </section>
  );
}
