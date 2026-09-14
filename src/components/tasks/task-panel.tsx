"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MemberPicker, type CrmMember } from "@/components/member-picker";
import { TASK_STATES } from "@/lib/project-contract";
import { taskRequest } from "./api";

export type Task = {
  id: string; projectId: string; projectName: string; title: string; description: string | null;
  estado: keyof typeof TASK_STATES; assigneeId: string | null; assigneeName: string | null;
  priority: string | null; dueDate: string | null;
};

export function TaskForm({ projectId, task, members, onSaved, onCancel }: {
  projectId: string; task?: Task; members: CrmMember[]; onSaved: () => void; onCancel?: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? null);
  const [estado, setEstado] = useState(task?.estado ?? "no_empezado");
  const [prioridad, setPrioridad] = useState(task?.priority ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="space-y-3 rounded-md border p-3" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await taskRequest(`/api/projects/${projectId}/tasks${task ? `/${task.id}` : ""}`, {
        method: task ? "PATCH" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description: description || null, assigneeId, estado, prioridad: prioridad || null, dueDate: dueDate ? `${dueDate}T12:00:00.000Z` : null }),
      });
      if (!task) { setTitle(""); setDescription(""); setDueDate(""); }
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la tarea"); }
    finally { setBusy(false); }
  }}>
    <fieldset disabled={busy} className="space-y-3">
      <legend className="mb-2 font-semibold">{task ? "Editar tarea" : "Nueva tarea"}</legend>
      <label className="block text-sm">Título<Input required maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="block text-sm">Descripción<textarea className="w-full rounded border bg-background p-2" maxLength={10000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <MemberPicker value={assigneeId} onChange={setAssigneeId} members={members} />
        <label className="block text-sm">Estado<select className="mt-1 w-full rounded border bg-background p-2" value={estado} onChange={(e) => setEstado(e.target.value as Task["estado"])}>{Object.entries(TASK_STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-sm">Prioridad<select className="mt-1 w-full rounded border bg-background p-2" value={prioridad} onChange={(e) => setPrioridad(e.target.value)}><option value="">Sin prioridad</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select></label>
        <label className="block text-sm">Fecha límite<Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex gap-2"><Button disabled={!title.trim()} type="submit">{busy ? "Guardando…" : task ? "Guardar tarea" : "Agregar tarea"}</Button>{onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>}</div>
    </fieldset>
  </form>;
}

export function TaskRow({ task, members, onUpdated, showProject }: { task: Task; members: CrmMember[]; onUpdated: () => void; showProject?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(changes?: object) {
    setBusy(true); setError("");
    try {
      await taskRequest(`/api/projects/${task.projectId}/tasks/${task.id}`, { method: changes ? "PATCH" : "DELETE", headers: { "content-type": "application/json" }, body: changes ? JSON.stringify(changes) : undefined });
      setDeleting(false); onUpdated();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo actualizar la tarea"); }
    finally { setBusy(false); }
  }
  return <li className="space-y-3 rounded-md border p-3" aria-label={`Tarea: ${task.title}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className={`font-medium ${task.estado === "terminado" ? "text-muted-foreground line-through" : ""}`}>{task.title}</h3><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(!editing)}>Editar</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting(true)}>Eliminar</Button></div></div>
    {showProject && <Link href={`/projects?projectId=${encodeURIComponent(task.projectId)}`} className="text-sm underline">{task.projectName}</Link>}
    {task.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>}
    <p className="text-xs text-muted-foreground">{task.priority ? `Prioridad ${task.priority}` : "Sin prioridad"}{task.dueDate ? ` · Vence ${task.dueDate.slice(0, 10)}` : ""}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <MemberPicker members={members} disabled={busy} value={task.assigneeId} onChange={(assigneeId) => void save({ assigneeId })} />
      <label className="block text-sm">Estado<select className="mt-1 w-full rounded border bg-background p-2" disabled={busy} value={task.estado} onChange={(e) => void save({ estado: e.target.value })}>{Object.entries(TASK_STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {deleting && <div className="flex flex-wrap items-center gap-2"><span>¿Eliminar esta tarea?</span><Button size="sm" variant="destructive" disabled={busy} onClick={() => void save()}>Confirmar eliminación</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setDeleting(false)}>Cancelar</Button></div>}
    {editing && <TaskForm task={task} projectId={task.projectId} members={members} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onUpdated(); }} />}
  </li>;
}
