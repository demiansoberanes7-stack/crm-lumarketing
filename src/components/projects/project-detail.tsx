"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EditProject } from "./edit-project";
import Link from "next/link";

interface ProjectDetail {
  id: string;
  contactId: string | null;
  notas: string | null;
  code: string;
  name: string;
  estado: string;
  avance: number;
  prioridad: string | null;
  riesgo: string | null;
  service: string | null;
  currentStageIndex: number;
}

interface Task {
  id: string;
  title: string;
  estado: string;
  priority: string | null;
}

interface Report {
  contact: { id: string; name: string | null; phone: string | null } | null;
  stats: { totalTasks: number; completed: number; pending: number };
}

const STAGES = [
  "Activación",
  "Diagnóstico",
  "Calendario de Contenido",
  "Creación de Contenido",
  "Campaña",
  "Reporte de Resultados",
  "Renovación",
];

const prioridadBadge: Record<string, "destructive" | "secondary" | "outline"> = {
  alta: "destructive",
  media: "secondary",
  baja: "outline",
};

export function ProjectDetail({
  projectId,
  onBack,
  onUpdated,
}: {
  projectId: string;
  onBack: () => void;
  onUpdated: () => void;
}) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");

  const refetch = useCallback(async () => {
    const [projRes, tasksRes, reportRes] = await Promise.all([
      fetch(`/api/projects/${projectId}`).catch(() => null),
      fetch(`/api/projects/${projectId}/tasks`).catch(() => null),
      fetch(`/api/projects/${projectId}/report`).catch(() => null),
    ]);

    if (projRes?.ok) {
      const data = (await projRes.json()) as { project: ProjectDetail };
      setProject(data.project);
    }
    if (tasksRes?.ok) {
      const data = (await tasksRes.json()) as { tasks: Task[] };
      setTasks(data.tasks);
    }
    if (reportRes?.ok) {
      const data = (await reportRes.json()) as { report: Report };
      setReport(data.report);
    }
  }, [projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function addTask() {
    const title = newTaskTitle.trim();
    if (!title) return;
    setAddingTask(true);
    await fetch(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => null);
    setNewTaskTitle("");
    setAddingTask(false);
    void refetch();
  }

  async function advanceStage() {
    if (!project) return;
    const nextIndex = project.currentStageIndex + 1;
    if (nextIndex >= STAGES.length) return;
    await fetch(`/api/projects/${projectId}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toStageId: String(nextIndex + 1) }),
    }).catch(() => null);
    void refetch();
    onUpdated();
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  const canAdvance = project.currentStageIndex < STAGES.length - 1;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {project.code}
            </span>
            <h2 className="text-[17px] font-bold tracking-tight">{project.name}</h2>
            <Badge variant={project.estado === "activo" ? "success" : project.estado === "reunion" ? "warning" : "secondary"}>
              {project.estado === "activo" ? "Activo" : project.estado === "reunion" ? "Reunion" : "Cerrado"}
            </Badge>
          </div>
          {project.service && (
            <p className="text-xs text-muted-foreground">{project.service}</p>
          )}
        </div>
        <Button onClick={() => setEditing(true)}>Editar proyecto</Button>
      </header>

      <div className="flex-1 space-y-6 p-4 sm:p-6">
        {notice && <p role="status">{notice}</p>}
        <p className="text-sm">Contacto: {report?.contact ? <Link className="underline" href={`/contacts?q=${encodeURIComponent(report.contact.name ?? report.contact.phone ?? "")}`}>{report.contact.name ?? report.contact.phone ?? "Ver contacto"}</Link> : "Sin contacto asignado"}</p>
        {editing && <EditProject project={project} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setNotice("Proyecto actualizado"); void refetch(); onUpdated(); }} />}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Avance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${project.avance}%` }}
                />
              </div>
              <span className="text-sm font-semibold tabular-nums">{project.avance}%</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm">Etapas del Proyecto</CardTitle>
            {canAdvance && (
              <Button size="sm" onClick={() => void advanceStage()}>
                Siguiente Etapa
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {STAGES.map((stage, i) => {
                const isCurrent = i === project.currentStageIndex;
                const isCompleted = i < project.currentStageIndex;
                const _isFuture = i > project.currentStageIndex;
                return (
                  <div
                    key={stage}
                    className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                      isCurrent
                        ? "bg-primary/10 font-semibold"
                        : isCompleted
                          ? "text-muted-foreground"
                          : "opacity-50"
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-success-text" />
                    ) : (
                      <Circle
                        className={`h-4 w-4 shrink-0 ${
                          isCurrent ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                    )}
                    <span>{stage}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tareas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Nueva tarea..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addTask();
                }}
              />
              <Button
                size="sm"
                disabled={!newTaskTitle.trim() || addingTask}
                onClick={() => void addTask()}
              >
                Agregar
              </Button>
            </div>
            {tasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin tareas aun</p>
            ) : (
              <ul className="space-y-1.5">
                {tasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="flex-1 truncate">{t.title}</span>
                    {t.priority && (
                      <Badge variant={prioridadBadge[t.priority] ?? "secondary"} className="shrink-0">
                        {t.priority}
                      </Badge>
                    )}
                    <Badge variant={t.estado === "completada" ? "success" : "outline"} className="shrink-0">
                      {t.estado}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {report && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Resumen</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{report.stats.totalTasks}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-success-text">{report.stats.completed}</p>
                  <p className="text-xs text-muted-foreground">Completadas</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-warning-text">{report.stats.pending}</p>
                  <p className="text-xs text-muted-foreground">Pendientes</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
