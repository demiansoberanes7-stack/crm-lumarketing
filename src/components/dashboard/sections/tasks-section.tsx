"use client";

import { CheckCircle2, Clock, UserX } from "lucide-react";
import { KpiCard } from "../kpi-card";
import { PieChartCard } from "../charts";
import { ChartCard } from "../chart-card";

interface Props {
  data: {
    total: number; completed: number; pending: number; notStarted: number;
    completedThisWeek: number; pendingDueSoon: number; overdue: number; unassigned: number;
    byPriority: { name: string; count: number }[];
  };
}

export function TasksSection({ data }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4" /> Tareas
      </h2>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard title="Terminadas actualizadas esta semana" value={data.completedThisWeek} subtitle="Por última actualización; lunes a hoy (UTC)" icon={<CheckCircle2 />} />
        <KpiCard title="Por vencer en 7 días" value={data.pendingDueSoon} icon={<Clock />}
          trend={data.pendingDueSoon > 5 ? "down" : "neutral"} />
        <KpiCard title="Sin asignar" value={data.unassigned} icon={<UserX />}
          trend={data.unassigned > 0 ? "down" : "neutral"} />
        <KpiCard title="Vencidas" value={data.overdue} />
        <KpiCard title="Total" value={data.total} />
        <KpiCard title="Completadas" value={data.completed} />
        <KpiCard title="No empezadas" value={data.notStarted} />
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <ChartCard title="Distribución por prioridad">
          <PieChartCard data={data.byPriority} nameKey="name" valueKey="count" inner />
        </ChartCard>
        <ChartCard title="Resumen de estados">
          <PieChartCard
            data={[
              { name: "Terminado", count: data.completed },
              { name: "Pendiente", count: data.pending },
              { name: "No empezado", count: data.notStarted },
            ]}
            nameKey="name" valueKey="count" inner
          />
        </ChartCard>
      </div>
    </section>
  );
}
