"use client";

import { FolderKanban, AlertTriangle } from "lucide-react";
import { KpiCard } from "../kpi-card";
import { BarChartCard, GaugeChart } from "../charts";

interface Props {
  data: {
    total: number; active: number; archived: number; completed: number;
    completionRate: number; avgAdvance: number; highRisk: number;
    projectsByStage: { name: string; count: number }[];
    projectsByAssignee: { name: string; count: number }[];
    avgTimeByStage: { stage: string; avgDays: number }[];
  };
}

export function ProjectsSection({ data }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground flex items-center gap-2">
        <FolderKanban className="h-4 w-4" /> Proyectos
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 mb-4">
        <KpiCard title="Activos" value={data.active} icon={<FolderKanban />} />
        <KpiCard title="Archivados" value={data.archived} icon={<FolderKanban />} />
        <KpiCard title="Avance Promedio" value={`${data.avgAdvance.toFixed(0)}%`} />
        <KpiCard title="Riesgo Alto" value={data.highRisk} icon={<AlertTriangle />}
          trend={data.highRisk > 0 ? "down" : "neutral"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Tasa de terminación</p>
          <GaugeChart value={data.completionRate} label="Completados" />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Proyectos por etapa</p>
          <BarChartCard data={data.projectsByStage} xKey="name" yKey="count" height={200} />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Tiempo promedio por etapa (días)</p>
          <BarChartCard data={data.avgTimeByStage} xKey="stage" yKey="avgDays" height={200} />
        </div>
      </div>
    </section>
  );
}
