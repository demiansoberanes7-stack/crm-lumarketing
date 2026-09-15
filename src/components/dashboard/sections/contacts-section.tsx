"use client";

import { Users } from "lucide-react";
import { KpiCard } from "../kpi-card";
import { PieChartCard } from "../charts";

interface Props {
  data: {
    total: number; active: number; newThisPeriod: number; retentionRate: number;
    bySource: { name: string; count: number }[];
  };
}

export function ContactsSection({ data }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <Users className="h-4 w-4" /> Contactos
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        <KpiCard title="Total" value={data.total} icon={<Users />} />
        <KpiCard title="Activos (con proyecto)" value={data.active} />
        <KpiCard title="Nuevos en período" value={data.newThisPeriod} />
        <KpiCard title="Retención" value={`${data.retentionRate.toFixed(0)}%`} />
      </div>
      {data.bySource.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Fuentes de contacto</p>
          <PieChartCard data={data.bySource} nameKey="name" valueKey="count" inner />
        </div>
      )}
    </section>
  );
}
