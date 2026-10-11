"use client";

import { FolderKanban, AlertTriangle } from "lucide-react";
import { KpiCard } from "../kpi-card";
import { BarChartCard, GaugeChart } from "../charts";
import { ChartCard } from "../chart-card";

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
        <KpiCard title="Archivados" value={data.archived} icon={<FolderKanban />} />
        <KpiCard title="Avance Promedio" value={`${data.avgAdvance.toFixed(0)}%`} />
        <KpiCard title="Riesgo Alto" value={data.highRisk} icon={<AlertTriangle />}
          trend={data.highRisk > 0 ? "down" : "neutral"} />
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <ChartCard title="Tasa de terminación">
          <GaugeChart value={data.completionRate} label="Completados" />
        </ChartCard>
        <ChartCard title="Proyectos por etapa">
          <BarChartCard data={data.projectsByStage} xKey="name" yKey="count" height={200} />
        </ChartCard>
        <ChartCard title="Tiempo promedio por etapa (días)">
          <BarChartCard data={data.avgTimeByStage} xKey="stage" yKey="avgDays" height={200} />
        </ChartCard>
      </div>
    </section>
  );
}
