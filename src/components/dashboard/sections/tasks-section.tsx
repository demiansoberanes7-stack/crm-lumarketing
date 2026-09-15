"use client";

import { CheckCircle2, Clock, UserX } from "lucide-react";
import { KpiCard } from "../kpi-card";
import { PieChartCard } from "../charts";

interface Props {
  data: {
    total: number; completed: number; pending: number; notStarted: number;
    completedThisWeek: number; pendingDueSoon: number; unassigned: number;
    byPriority: { name: string; count: number }[];
  };
}

export function TasksSection({ data }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4" /> Tareas
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 mb-4">
        <KpiCard title="Completadas esta semana" value={data.completedThisWeek} icon={<CheckCircle2 />} />
        <KpiCard title="Pendientes por vencer" value={data.pendingDueSoon} icon={<Clock />}
          trend={data.pendingDueSoon > 5 ? "down" : "neutral"} />
        <KpiCard title="Sin asignar" value={data.unassigned} icon={<UserX />}
          trend={data.unassigned > 0 ? "down" : "neutral"} />
        <KpiCard title="Total" value={data.total} />
        <KpiCard title="Completadas" value={data.completed} />
        <KpiCard title="No empezadas" value={data.notStarted} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Distribución por prioridad</p>
          <PieChartCard data={data.byPriority} nameKey="name" valueKey="count" inner />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Resumen de estados</p>
          <PieChartCard
            data={[
              { name: "Terminado", count: data.completed },
              { name: "Pendiente", count: data.pending },
              { name: "No empezado", count: data.notStarted },
            ]}
            nameKey="name" valueKey="count" inner
          />
        </div>
      </div>
    </section>
  );
}
