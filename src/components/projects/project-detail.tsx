"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, CheckCircle2, Circle, FileText, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditProject } from "./edit-project";
import { TaskForm, TaskRow, type Task } from "@/components/tasks/task-panel";
import { type CrmMember } from "@/components/member-picker";
import { taskRequest } from "@/components/tasks/api";
import { PdfActions } from "@/components/pdf-actions";
import {
  PROJECT_STATUS_BADGE,
  PROJECT_STATUS_LABELS,
  getProjectType,
  type ProjectStatus,
} from "@/lib/project-types";
import Link from "next/link";

interface Project {
  id: string; contactId: string | null; notas: string | null; code: string; name: string;
  projectType: string; status: ProjectStatus; avance: number; prioridad: string | null; riesgo: string | null;
  service: string | null; assignedUserId: string | null; stageId: string | null; currentStageIndex: number;
  startDate: string | null; endDate: string | null; archivedAt: string | null;
  stages: { id: string; name: string; position: number }[];
}
interface Report {
  contact: { id: string; name: string | null; phone: string | null } | null;
  stageHistory: { id: string; fromStageName: string | null; toStageName: string; source: string; createdAt: string }[];
}
interface StepView {
  key: string;
  label: string;
  description: string | null;
  kind: "project" | "data";
  position: number;
  status: "pendiente" | "en_proceso" | "completado";
  data: Record<string, unknown>;
  completedAt: string | null;
}

const STEP_LABEL: Record<StepView["status"], string> = {
  pendiente: "Pendiente",
  en_proceso: "Borrador",
  completado: "Completado",
};

export function ProjectDetail({
  projectId,
  onBack,
  onUpdated,
  onOpenWizard,
}: {
  projectId: string;
  onBack: () => void;
  onUpdated: () => void;
  onOpenWizard?: (step?: number) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [steps, setSteps] = useState<StepView[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<CrmMember[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refetch = useCallback(async () => {
    try {
      const [p, s, t, r, m] = await Promise.all([
        taskRequest<{ project: Project }>(`/api/projects/${projectId}`),
        taskRequest<{ steps: StepView[] }>(`/api/projects/${projectId}/steps`),
        taskRequest<{ tasks: Task[] }>(`/api/projects/${projectId}/tasks`),
        taskRequest<{ report: Report }>(`/api/projects/${projectId}/report`),
        taskRequest<{ members: CrmMember[] }>("/api/members"),
      ]);
      setProject(p.project); setSteps(s.steps); setTasks(t.tasks); setReport(r.report); setMembers(m.members);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar el proyecto"); }
  }, [projectId]);
  useEffect(() => { void refetch(); const refresh = () => void refetch(); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [refetch]);

  async function handleArchive(archive: boolean) {
    if (!project) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await taskRequest(`/api/projects/${projectId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: archive ? "archive" : "unarchive" }),
      });
      await refetch(); onUpdated(); setNotice(archive ? "Proyecto archivado" : "Proyecto desarchivado");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo archivar/desarchivar"); await refetch(); }
    finally { setBusy(false); }
  }

  async function changeStatus(status: ProjectStatus, okMessage: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await taskRequest(`/api/projects/${projectId}/status`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await refetch(); onUpdated(); setNotice(okMessage);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cambiar el estado"); await refetch(); }
    finally { setBusy(false); }
  }

  if (!project) return <div className="space-y-3 p-6"><Button variant="outline" onClick={onBack}>Volver a proyectos</Button>{error ? <><p role="alert" className="text-destructive">{error}</p><Button onClick={() => void refetch()}>Reintentar</Button></> : <p role="status">Cargando proyecto…</p>}</div>;

  const typeLabel = getProjectType(project.projectType)?.label ?? project.projectType;
  const completedSteps = steps.filter((s) => s.status === "completado").length;
  const firstPending = steps.findIndex((s) => s.status !== "completado");
  const finalized = project.status === "completado" || project.status === "cancelado";
  const completedTasks = tasks.filter((t) => t.estado === "terminado").length;
  const dateFmt = (v: string | null) => (v ? new Date(v).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "—");

  return <div className="flex h-full flex-col overflow-y-auto">
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
      <Button variant="ghost" size="icon" aria-label="Volver a proyectos" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
      <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{project.code}</p><h1 className="text-lg font-bold">{project.name}</h1><p className="text-sm">{project.service}</p></div>
      <Badge variant="outline">{typeLabel}</Badge>
      <Badge variant={PROJECT_STATUS_BADGE[project.status] ?? "secondary"}>{PROJECT_STATUS_LABELS[project.status] ?? project.status}</Badge>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleArchive(!project.archivedAt)}>
        {project.archivedAt ? <ArchiveRestore className="mr-1.5 h-4 w-4" /> : <Archive className="mr-1.5 h-4 w-4" />}
        {project.archivedAt ? "Desarchivar" : "Archivar"}
      </Button>
      <PdfActions url={`/api/projects/${projectId}/pdf`} filename={`${project.code}.pdf`} />
      <Button onClick={() => setEditing(true)}>Editar proyecto</Button>
    </header>
    <div className="space-y-6 p-4 sm:p-6">
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}

      {/* Datos generales */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Datos generales</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Inicio: {dateFmt(project.startDate)} · Término: {dateFmt(project.endDate)}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenWizard?.(0)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Contacto: {report?.contact ? <Link className="underline" href={`/contacts?q=${encodeURIComponent(report.contact.name ?? report.contact.phone ?? "")}`}>{report.contact.name ?? report.contact.phone ?? "Ver contacto"}</Link> : "Sin contacto asignado"}</p>
          <p>Responsable del proyecto: {members.find((m) => m.userId === project.assignedUserId)?.name ?? "Sin asignar"}</p>
          {project.notas && <p className="whitespace-pre-wrap text-muted-foreground">{project.notas}</p>}
          {editing && <EditProject project={project} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setNotice("Proyecto actualizado"); void refetch(); onUpdated(); }} />}
        </CardContent>
      </Card>

      {/* Avance */}
      <Card><CardHeader><CardTitle className="text-sm">Avance</CardTitle></CardHeader><CardContent><div className="flex items-center gap-3"><div role="progressbar" aria-label="Avance del proyecto" aria-valuenow={project.avance} aria-valuemin={0} aria-valuemax={100} className="h-3 flex-1 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${project.avance}%` }} /></div><span>{project.avance}%</span></div></CardContent></Card>

      {/* Expediente por pasos */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Expediente · {typeLabel}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{completedSteps} de {steps.length} pasos completados</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => onOpenWizard?.(firstPending >= 0 ? firstPending : 0)}>
              <FileText className="mr-1.5 h-4 w-4" />
              {completedSteps === steps.length ? "Revisar expediente" : "Continuar expediente"}
            </Button>
            {!finalized && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void changeStatus("completado", "Proyecto finalizado")}>
                Finalizar
              </Button>
            )}
            {finalized && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void changeStatus("en_proceso", "Proyecto reabierto")}>
                Reabrir
              </Button>
            )}
            {!finalized && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void changeStatus("cancelado", "Proyecto cancelado")}>
                Cancelar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {steps.map((step, i) => {
              const active = step.status === "en_proceso";
              const done = step.status === "completado";
              return (
                <li key={step.key}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-current={active ? "step" : undefined}
                    onClick={() => onOpenWizard?.(i)}
                    className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-default ${active ? "bg-primary/10 font-semibold" : ""}`}
                  >
                    {done ? <CheckCircle2 className="h-4 w-4 text-success-text" /> : <Circle className="h-4 w-4" />}
                    <span className="flex-1">{i + 1}. {step.label}</span>
                    <span className="text-xs text-muted-foreground">{STEP_LABEL[step.status]}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          {!steps.length && <p className="text-sm text-muted-foreground">Sin pasos todavía</p>}
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="text-sm">Tareas</CardTitle></CardHeader><CardContent className="space-y-4">
        <TaskForm projectId={projectId} members={members} onSaved={() => void refetch()} />
        {tasks.length ? <ul className="space-y-3">{tasks.map((task) => <TaskRow key={task.id} task={task} members={members} onUpdated={() => void refetch()} />)}</ul> : <p className="text-sm text-muted-foreground">Sin tareas todavía</p>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm">Resumen de tareas</CardTitle></CardHeader><CardContent><p>Total: {tasks.length} · Terminadas: {completedTasks} · Pendientes: {tasks.filter((t) => t.estado === "pendiente").length} · No empezadas: {tasks.filter((t) => t.estado === "no_empezado").length}</p></CardContent></Card>
      {!!report?.stageHistory.length && <Card><CardHeader><CardTitle className="text-sm">Historial de etapas</CardTitle></CardHeader><CardContent><ul className="space-y-2 text-sm">{report.stageHistory.map((event) => <li key={event.id}>{event.fromStageName ?? "Inicio"} → {event.toStageName}{event.source === "completado" ? " (proyecto terminado)" : ""} · {new Date(event.createdAt).toLocaleString("es-MX")}</li>)}</ul></CardContent></Card>}
    </div>
  </div>;
}
