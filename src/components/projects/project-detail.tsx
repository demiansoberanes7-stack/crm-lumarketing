"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditProject } from "./edit-project";
import { TaskForm, TaskRow, type Task } from "@/components/tasks/task-panel";
import { type CrmMember } from "@/components/member-picker";
import { taskRequest } from "@/components/tasks/api";
import Link from "next/link";

interface Project {
  id: string; contactId: string | null; notas: string | null; code: string; name: string;
  estado: string; avance: number; prioridad: string | null; riesgo: string | null;
  service: string | null; assignedUserId: string | null; stageId: string | null; currentStageIndex: number;
  stages: { id: string; name: string; position: number }[];
}
interface Report {
  contact: { id: string; name: string | null; phone: string | null } | null;
  stageHistory: { id: string; fromStageName: string | null; toStageName: string; source: string; createdAt: string }[];
}

export function ProjectDetail({ projectId, onBack, onUpdated }: { projectId: string; onBack: () => void; onUpdated: () => void }) {
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<CrmMember[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refetch = useCallback(async () => {
    try {
      const [p, t, r, m] = await Promise.all([
        taskRequest<{ project: Project }>(`/api/projects/${projectId}`),
        taskRequest<{ tasks: Task[] }>(`/api/projects/${projectId}/tasks`),
        taskRequest<{ report: Report }>(`/api/projects/${projectId}/report`),
        taskRequest<{ members: CrmMember[] }>("/api/members"),
      ]);
      setProject(p.project); setTasks(t.tasks); setReport(r.report); setMembers(m.members);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar el proyecto"); }
  }, [projectId]);
  useEffect(() => { void refetch(); const refresh = () => void refetch(); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [refetch]);

  async function moveStage(toStageId: string, complete = false) {
    if (!project) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await taskRequest(`/api/projects/${projectId}/transition`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ toStageId, complete, expectedStageId: project.stageId ?? undefined }),
      });
      await refetch(); onUpdated(); setNotice(complete ? "Todas las etapas completadas. Proyecto terminado." : "Etapa actualizada");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cambiar la etapa"); await refetch(); }
    finally { setBusy(false); }
  }

  if (!project) return <div className="space-y-3 p-6"><Button variant="outline" onClick={onBack}>Volver a proyectos</Button>{error ? <><p role="alert" className="text-destructive">{error}</p><Button onClick={() => void refetch()}>Reintentar</Button></> : <p role="status">Cargando proyecto…</p>}</div>;
  const stages = project.stages;
  const current = stages[project.currentStageIndex];
  const previous = stages[project.currentStageIndex - 1];
  const next = stages[project.currentStageIndex + 1];
  const finished = project.estado === "cerrado" && project.avance === 100;
  const completed = tasks.filter((t) => t.estado === "terminado").length;

  return <div className="flex h-full flex-col overflow-y-auto">
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
      <Button variant="ghost" size="icon" aria-label="Volver a proyectos" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
      <div className="flex-1"><p className="text-xs text-muted-foreground">{project.code}</p><h1 className="text-lg font-bold">{project.name}</h1><p className="text-sm">{project.service}</p></div>
      <Badge variant={finished ? "success" : "secondary"}>{finished ? "Terminado" : project.estado === "activo" ? "Activo" : project.estado === "reunion" ? "Reunión" : "Cerrado"}</Badge>
      <Button onClick={() => setEditing(true)}>Editar proyecto</Button>
    </header>
    <div className="space-y-6 p-4 sm:p-6">
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <p className="text-sm">Contacto: {report?.contact ? <Link className="underline" href={`/contacts?q=${encodeURIComponent(report.contact.name ?? report.contact.phone ?? "")}`}>{report.contact.name ?? report.contact.phone ?? "Ver contacto"}</Link> : "Sin contacto asignado"}</p>
      <p className="text-sm">Responsable del proyecto: {members.find((m) => m.userId === project.assignedUserId)?.name ?? "Sin asignar"}</p>
      {editing && <EditProject project={project} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setNotice("Proyecto actualizado"); void refetch(); onUpdated(); }} />}
      <Card><CardHeader><CardTitle className="text-sm">Avance</CardTitle></CardHeader><CardContent><div className="flex items-center gap-3"><div role="progressbar" aria-label="Avance del proyecto" aria-valuenow={project.avance} aria-valuemin={0} aria-valuemax={100} className="h-3 flex-1 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${project.avance}%` }} /></div><span>{project.avance}%</span></div></CardContent></Card>
      <Card>
        <CardHeader className="gap-3"><CardTitle className="text-sm">Etapas del Proyecto</CardTitle>
          <div className="flex flex-wrap gap-2">
            {previous && <Button variant="outline" size="sm" disabled={busy} onClick={() => void moveStage(previous.id)}>Etapa anterior</Button>}
            {current && !finished && <Button size="sm" disabled={busy} onClick={() => void moveStage(next?.id ?? current.id, !next)}>{busy ? "Guardando…" : next ? "Completar etapa y continuar" : "Terminar proyecto"}</Button>}
            {current && finished && <Button size="sm" variant="outline" disabled={busy} onClick={() => void moveStage(current.id)}>Reabrir última etapa</Button>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3"><p className="text-xs text-muted-foreground">Selecciona una etapa para cambiarla. Las anteriores quedarán completadas; volver atrás reabre esa etapa y las siguientes.</p>
          <ol className="space-y-2">{stages.map((stage, i) => {
            const done = finished || i < project.currentStageIndex;
            const active = !finished && i === project.currentStageIndex;
            return <li key={stage.id}><button type="button" disabled={busy || active} aria-current={active ? "step" : undefined} onClick={() => void moveStage(stage.id)} className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-default ${active ? "bg-primary/10 font-semibold" : ""}`}>
              {done ? <CheckCircle2 className="h-4 w-4 text-success-text" /> : <Circle className="h-4 w-4" />}<span className="flex-1">{stage.name}</span><span className="text-xs">{done ? "Completada" : active ? "Actual" : "No empezada"}</span>
            </button></li>;
          })}</ol>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="text-sm">Tareas</CardTitle></CardHeader><CardContent className="space-y-4">
        <TaskForm projectId={projectId} members={members} onSaved={() => void refetch()} />
        {tasks.length ? <ul className="space-y-3">{tasks.map((task) => <TaskRow key={task.id} task={task} members={members} onUpdated={() => void refetch()} />)}</ul> : <p className="text-sm text-muted-foreground">Sin tareas todavía</p>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm">Resumen de tareas</CardTitle></CardHeader><CardContent><p>Total: {tasks.length} · Terminadas: {completed} · Pendientes: {tasks.filter((t) => t.estado === "pendiente").length} · No empezadas: {tasks.filter((t) => t.estado === "no_empezado").length}</p></CardContent></Card>
      {!!report?.stageHistory.length && <Card><CardHeader><CardTitle className="text-sm">Historial de etapas</CardTitle></CardHeader><CardContent><ul className="space-y-2 text-sm">{report.stageHistory.map((event) => <li key={event.id}>{event.fromStageName ?? "Inicio"} → {event.toStageName}{event.source === "completado" ? " (proyecto terminado)" : ""} · {new Date(event.createdAt).toLocaleString("es-MX")}</li>)}</ul></CardContent></Card>}
    </div>
  </div>;
}
