"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react";
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
  archivedAt: string | null;
}

const estadoBadge: Record<string, "success" | "warning" | "secondary"> = {
  activo: "success",
  reunion: "warning",
  cerrado: "secondary",
};

export function ProjectsClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const [activeRes, archivedRes] = await Promise.all([
      fetch("/api/projects?archived=false").catch(() => null),
      fetch("/api/projects?archived=true").catch(() => null),
    ]);
    if (activeRes?.ok) {
      const data = (await activeRes.json()) as { projects: Project[] };
      setProjects(data.projects);
    }
    if (archivedRes?.ok) {
      const data = (await archivedRes.json()) as { projects: Project[] };
      setArchivedProjects(data.projects);
    }
  }, []);

  useEffect(() => {
    setSelectedProject(new URLSearchParams(window.location.search).get("projectId"));
    void refetch();
  }, [refetch]);

  const handleArchive = async (projectId: string, archive: boolean) => {
    await fetch(`/api/projects/${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: archive ? "archive" : "unarchive" }),
    });
    void refetch();
  };

  const handleDelete = async (projectId: string) => {
    if (!confirm("¿Eliminar este proyecto archivado? Esta accion no se puede deshacer.")) return;
    await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
    void refetch();
  };

  if (selectedProject) {
    return (
      <ProjectDetail
        projectId={selectedProject}
        onBack={() => { setSelectedProject(null); window.history.replaceState(null, "", "/projects"); }}
        onUpdated={() => void refetch()}
      />
    );
  }

  const displayedProjects = showArchived ? archivedProjects : projects;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Proyectos</h2>
        <Button size="sm" onClick={() => setShowNewProject(true)}>
          <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
          Nuevo Proyecto
        </Button>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 border-b px-4 sm:px-6">
        <button
          onClick={() => setShowArchived(false)}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            !showArchived
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Activos ({projects.length})
        </button>
        <button
          onClick={() => setShowArchived(true)}
          className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            showArchived
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Archivados ({archivedProjects.length})
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {displayedProjects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium">
              {showArchived ? "Sin proyectos archivados" : "Sin proyectos"}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {showArchived
                ? "Los proyectos archivados aparecerán aquí."
                : "Crea tu primer proyecto para comenzar a dar seguimiento a tus servicios."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayedProjects.map((p) => (
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
                  <div className="flex items-center gap-1">
                    {showArchived && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                        title="Eliminar permanentemente"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={(e) => { e.stopPropagation(); handleArchive(p.id, !showArchived); }}
                      title={showArchived ? "Desarchivar" : "Archivar"}
                    >
                      {showArchived ? (
                        <ArchiveRestore className="h-3.5 w-3.5" />
                      ) : (
                        <Archive className="h-3.5 w-3.5" />
                      )}
                    </Button>
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
