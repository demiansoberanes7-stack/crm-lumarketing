"use client";

import { MessageSquare } from "lucide-react";
import { KpiCard } from "../kpi-card";
import { PieChartCard } from "../charts";
import { ChartCard } from "../chart-card";

interface Props {
  data: {
    active: number;
    byChannel: { name: string; count: number }[];
  };
}

export function InboxSection({ data }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <MessageSquare className="h-4 w-4" /> Bandeja
      </h2>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-2">
        <KpiCard title="Conversaciones Activas" value={data.active} icon={<MessageSquare />} />
        <KpiCard title="Canales" value={data.byChannel.length} />
      </div>
      {data.byChannel.length > 0 && (
        <ChartCard title="Distribución por canal">
          <PieChartCard data={data.byChannel} nameKey="name" valueKey="count" inner />
        </ChartCard>
      )}
    </section>
  );
}
