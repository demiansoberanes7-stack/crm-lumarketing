"use client";
import { useCallback, useEffect, useState } from "react";
import { MemberPicker, type CrmMember } from "@/components/member-picker";
import { Button } from "@/components/ui/button";
import { TASK_STATES } from "@/lib/project-contract";
import { taskRequest } from "./api";
import { TaskRow, type Task } from "./task-panel";

export function TasksClient() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<CrmMember[]>([]);
  const [estado, setEstado] = useState("");
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const [data, team] = await Promise.all([taskRequest<{ tasks: Task[] }>("/api/tareas"), taskRequest<{ members: CrmMember[] }>("/api/members")]);
      setTasks(data.tasks); setMembers(team.members); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudieron cargar las tareas"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const refresh = () => void load(); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [load]);
  const projects = Array.from(new Map(tasks.map((t) => [t.projectId, t.projectName])).entries());
  const visible = tasks.filter((t) => (!estado || t.estado === estado) && (!projectId || t.projectId === projectId) && (!assigneeId || t.assigneeId === assigneeId));
  return <div className="h-full space-y-5 overflow-y-auto p-4 sm:p-6">
    <header className="flex items-center justify-between"><div><h1 className="text-xl font-bold">Tareas</h1><p className="text-sm text-muted-foreground">Todas las tareas de los proyectos de tu organización</p></div><Button variant="outline" onClick={() => void load()}>Actualizar</Button></header>
    <div className="grid grid-cols-3 gap-3">{Object.entries(TASK_STATES).map(([state, label]) => <div key={state} className="rounded-lg border p-3"><p className="text-2xl font-bold">{tasks.filter((t) => t.estado === state).length}</p><p className="text-sm">{label}</p></div>)}</div>
    <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
      <label className="text-sm">Filtrar estado<select className="mt-1 w-full rounded border bg-background p-2" value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option>{Object.entries(TASK_STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Filtrar proyecto<select className="mt-1 w-full rounded border bg-background p-2" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Todos</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <MemberPicker label="Filtrar responsable" emptyLabel="Todos" members={members} value={assigneeId} onChange={setAssigneeId} />
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {loading ? <p role="status">Cargando tareas…</p> : visible.length ? <ul className="space-y-3">{visible.map((task) => <TaskRow key={task.id} task={task} members={members} showProject onUpdated={() => void load()} />)}</ul> : <p>No hay tareas con estos filtros. Puedes crearlas desde Proyectos.</p>}
  </div>;
}
