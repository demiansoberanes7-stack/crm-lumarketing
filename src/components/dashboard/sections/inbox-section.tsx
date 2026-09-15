"use client";

import { MessageSquare } from "lucide-react";
import { KpiCard } from "../kpi-card";
import { PieChartCard } from "../charts";

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
        <KpiCard title="Conversaciones Activas" value={data.active} icon={<MessageSquare />} />
        <KpiCard title="Canales" value={data.byChannel.length} />
      </div>
      {data.byChannel.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Distribución por canal</p>
          <PieChartCard data={data.byChannel} nameKey="name" valueKey="count" inner />
        </div>
      )}
    </section>
  );
}
