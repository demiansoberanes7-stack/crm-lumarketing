"use client";

import { useState } from "react";
import { GanttChart, type GanttItem } from "./charts";
import { ChartCard } from "./chart-card";

interface Props {
  projects: GanttItem[];
  tasks: GanttItem[];
}

export function GanttSection({ projects, tasks }: Props) {
  const [tab, setTab] = useState<"projects" | "tasks">("projects");
  const items = tab === "projects" ? projects : tasks;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Cronograma (Gantt)
      </h2>
      <ChartCard title={tab === "projects" ? "Proyectos activos por rango de fechas" : "Tareas pendientes por fecha límite"}>
        <div className="mb-3 flex gap-1">
          <button
            onClick={() => setTab("projects")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "projects" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            Proyectos ({projects.length})
          </button>
          <button
            onClick={() => setTab("tasks")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "tasks" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            Tareas ({tasks.length})
          </button>
        </div>
        <GanttChart items={items} />
      </ChartCard>
    </section>
  );
}
