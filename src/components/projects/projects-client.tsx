"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewProjectDialog } from "./new-project-dialog";
import { ProjectDetail } from "./project-detail";

interface Project {
  id: string;
  code: string;
  name: string;
  contactId: string | null;
  service: string | null;
  estado: string;
  avance: number;
  prioridad: string | null;
  riesgo: string | null;
}

const estadoBadge: Record<string, "success" | "warning" | "secondary"> = {
  activo: "success",
  reunion: "warning",
  cerrado: "secondary",
};

export function ProjectsClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/projects").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { projects: Project[] };
    setProjects(data.projects);
  }, []);

  useEffect(() => {
    setSelectedProject(new URLSearchParams(window.location.search).get("projectId"));
    void refetch();
  }, [refetch]);

  if (selectedProject) {
    return (
      <ProjectDetail
        projectId={selectedProject}
        onBack={() => { setSelectedProject(null); window.history.replaceState(null, "", "/projects"); }}
        onUpdated={() => void refetch()}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Proyectos</h2>
        <Button size="sm" onClick={() => setShowNewProject(true)}>
          <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
          Nuevo Proyecto
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium">Sin proyectos</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Crea tu primer proyecto para comenzar a dar seguimiento a tus servicios.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => (
              <Card
                key={p.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedProject(p.id); } }}
                onClick={() => setSelectedProject(p.id)}
              >
                <CardHeader className="flex-row items-center justify-between gap-2 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {p.code}
                      </span>
                      <CardTitle className="text-sm">{p.name}</CardTitle>
                      <Badge variant={estadoBadge[p.estado] ?? "secondary"}>
                        {p.estado === "activo"
                          ? "Activo"
                          : p.estado === "reunion"
                            ? "Reunion"
                            : "Cerrado"}
                      </Badge>
                      {p.prioridad && (
                        <Badge
                          variant={
                            p.prioridad === "alta"
                              ? "destructive"
                              : p.prioridad === "baja"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {p.prioridad}
                        </Badge>
                      )}
                    </div>
                    {p.service && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.service}
                      </p>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${p.avance}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium tabular-nums text-muted-foreground">
                      {p.avance}%
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showNewProject && (
        <NewProjectDialog
          onClose={() => setShowNewProject(false)}
          onCreated={() => {
            setShowNewProject(false);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
