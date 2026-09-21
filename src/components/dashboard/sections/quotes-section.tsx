"use client";

import { FileText } from "lucide-react";
import { KpiCard, formatCurrency, formatPercent } from "../kpi-card";
import { FunnelChart, LineChartCard, PieChartCard } from "../charts";

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 mb-4">
        <KpiCard title="Ticket Promedio" value={formatCurrency(data.avgTicket)} icon={<FileText />} />
        <KpiCard title="Tasa de Aprobación" value={formatPercent(data.approvalRate)} subtitle="Aceptadas / enviadas, incl. rechazadas y expiradas" />
        <KpiCard title="Pipeline del período" value={formatCurrency(data.pipelineValue)} subtitle="Borradores y enviadas vigentes" />
        <KpiCard title="Descuento Promedio" value={formatCurrency(data.avgDiscount)} />
        <KpiCard title="Enviadas" value={data.sent} />
        <KpiCard title="Aprobadas" value={data.approved} />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Cohorte por fecha de creación, sin archivadas. Enviadas incluye aceptadas, rechazadas y expiradas. {data.excludedCurrency > 0 && `${data.excludedCurrency} cotizaciones en otras monedas excluidas de los KPIs MXN.`}</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Embudo de conversión</p>
          <FunnelChart data={[
            { stage: "Creadas", value: data.total },
            { stage: "Enviadas", value: data.sent },
            { stage: "Aprobadas", value: data.approved },
          ]} />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Cotizaciones por mes</p>
          <LineChartCard data={data.byMonth} xKey="month" yKeys={["sent", "approved"]} height={200} />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Por canal de envío</p>
          <PieChartCard data={data.byChannel} nameKey="name" valueKey="count" inner />
        </div>
      </div>
    </section>
  );
}
